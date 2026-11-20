// Real-browser outcome checks with synthetic transport only. No production auth or data.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cacheDir = await mkdtemp(path.join(tmpdir(), 'flash-audit-outcomes-'));
let mode = 'success';
let release;
let held;
const setMode = next => { mode = next; if (next === 'hold') held = new Promise(resolve => { release = resolve; }); };
const fixture = await createServer({
  cacheDir, envDir: false,
  server: { host: '127.0.0.1', port: process.argv.includes('--serve-only') ? 5198 : 0, strictPort: true, hmr: false },
  optimizeDeps: { include: ['react', 'react-dom/client', '@tanstack/react-query', 'zustand', 'lucide-react', 'clsx'] },
  plugins: [{
    name: 'synthetic-audit-outcomes',
    resolveId(id) { if (id === 'virtual:audit-outcomes') return id; },
    load(id) {
      if (id !== 'virtual:audit-outcomes') return;
      return `import React from 'react';import {createRoot} from 'react-dom/client';
        import {QueryClientProvider,onlineManager} from '@tanstack/react-query';
        import {queryClient as client} from '/src/lib/queryClient.ts';
        import AuditLog from '/src/pages/AuditLog.tsx';import {useContextStore} from '/src/stores/context.ts';
        import '/src/index.css';
        useContextStore.setState({activeEnvironment:{id:'fixture-a',name:'Synthetic environment'}});
        window.auditFixtureOnline=value=>onlineManager.setOnline(value);
        if(new URL(location.href).searchParams.has('offline'))onlineManager.setOnline(false);
        window.auditFixtureRefresh=()=>client.invalidateQueries({queryKey:['audit']});
        window.auditFixtureScope=id=>useContextStore.setState({activeEnvironment:{id,name:'Synthetic environment'}});
        createRoot(document.querySelector('#app')).render(React.createElement(QueryClientProvider,{client},React.createElement(AuditLog)));`;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url, fixture.resolvedUrls.local[0]);
          if (url.pathname === '/fixture') {
            if (process.argv.includes('--serve-only')) setMode(url.searchParams.get('state') || 'denied');
            res.setHeader('Content-Type', 'text/html');
            res.end(await server.transformIndexHtml('/fixture', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:audit-outcomes"></script></body></html>'));
            return;
          }
          if (url.pathname !== '/api/audit/log') return next();
          const outcome = mode;
          if (outcome === 'hold') await held;
          res.setHeader('Content-Type', 'application/json');
          if (outcome === 'denied' || outcome === 'unavailable') {
            res.statusCode = outcome === 'denied' ? 403 : 503;
            res.end('{"error":"Synthetic unavailable"}'); return;
          }
          const entries = outcome === 'empty' || outcome === 'hold' ? [] : [{
            id: 'fixture-audit', environment_id: url.searchParams.get('environment_id'), action: 'policy.created',
            target: 'Synthetic policy ' + url.searchParams.get('environment_id'), actor: 'Synthetic operator', created_at: '2026-11-20T09:00:00Z',
          }];
          res.end(JSON.stringify({ entries, total: entries.length }));
        } catch (error) { next(error); }
      });
    },
  }],
});
let browser;
try {
  await fixture.listen();
  if (process.argv.includes('--serve-only')) {
    console.log(fixture.resolvedUrls.local[0] + 'fixture?state=denied');
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  } else {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const screenshots = process.env.AUDIT_OUTCOMES_SCREENSHOTS;
    const cases = [];
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const live = page.getByLabel(/^Live page\./);
      async function capture(name) {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (screenshots) { await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, name + '-' + width + '.png'), fullPage: true }); }
      }
      setMode('hold'); await page.goto(new URL('/fixture', fixture.resolvedUrls.local[0]).href, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Audit Log' }).waitFor();
      assert.equal(await live.count(), 0); assert.equal(await page.getByText('No audit entries found.').count(), 0);
      await capture('loading'); release();
      await page.getByText('No audit entries found.').waitFor(); assert.equal(await live.count(), 1); await capture('empty');
      setMode('success'); await page.evaluate(() => window.auditFixtureRefresh());
      await page.getByText('Synthetic policy fixture-a', { exact: true }).waitFor();
      setMode('denied'); await page.evaluate(() => window.auditFixtureRefresh());
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByText('Synthetic policy fixture-a', { exact: true }).count(), 0); assert.equal(await live.count(), 0);
      assert.match(await page.getByRole('alert').innerText(), /do not have permission/); await capture('denied');
      const filter=page.getByRole('combobox');
      await filter.selectOption('auth.login');await page.getByRole('alert').waitFor();
      await filter.selectOption('');await page.getByRole('alert').waitFor();
      assert.equal(await page.getByText('Synthetic policy fixture-a', { exact: true }).count(),0);assert.equal(await live.count(),0);
      setMode('success'); await page.getByRole('button', { name: 'Retry audit log' }).focus(); await page.keyboard.press('Enter');
      await page.getByText('Synthetic policy fixture-a', { exact: true }).waitFor(); assert.equal(await live.count(), 1);
      setMode('unavailable'); await page.evaluate(() => {void window.auditFixtureRefresh();});
      await page.getByRole('alert').waitFor();
      await page.waitForFunction(() => document.querySelector('button[aria-label="Retry audit log"]')?.disabled === true); assert.match(await page.getByRole('alert').innerText(), /could not be refreshed/);
      assert.equal(await live.count(), 0); assert.equal(await page.getByText('Synthetic policy fixture-a', { exact: true }).count(), 0);
      await capture('refresh-failed');
      await page.waitForFunction(() => document.querySelector('button[aria-label="Retry audit log"]')?.disabled === false);
      setMode('hold'); await page.getByRole('button', { name: 'Retry audit log' }).focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('button[aria-label="Retry audit log"]')?.disabled === true);
      await page.getByRole('button', { name: 'Retry audit log' }).isDisabled().then(disabled => assert.equal(disabled, true));
      release(); await page.getByText('No audit entries found.').waitFor();
      setMode('success'); await page.evaluate(() => window.auditFixtureRefresh()); await page.getByText('Synthetic policy fixture-a', { exact: true }).waitFor();
      setMode('hold'); await page.evaluate(() => window.auditFixtureScope('fixture-b'));
      await page.getByText('Synthetic policy fixture-a', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.getByText('Synthetic policy fixture-a', { exact: true }).count(), 0); assert.equal(await live.count(), 0);
      release(); await page.getByText('No audit entries found.').waitFor();
      setMode('unavailable'); await page.reload(); await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Unable to load/); assert.equal(await page.getByText('No audit entries found.').count(), 0); assert.equal(await live.count(), 0);
      await capture('initial-failed');
      setMode('empty');await page.goto(new URL('/fixture?offline=1',fixture.resolvedUrls.local[0]).href);
      await page.getByRole('status').filter({hasText:'waiting for a network connection'}).waitFor();
      assert.equal(await live.count(),0);assert.equal(await page.getByText('No audit entries found.').count(),0);await capture('offline');
      await page.evaluate(()=>window.auditFixtureOnline(true));await page.getByText('No audit entries found.').waitFor();assert.equal(await live.count(),1);
      cases.push({ width, loading: true, empty: true, denied_refresh: true, retry_keyboard: true, transient_refresh: true, pending_retry: true, environment_switch: true, initial_unavailable: true, denied_cache_variants:true, automatic_retry:true, offline_pause:true, online_recovery:true });
      await page.close();
    }
    console.log(JSON.stringify({ synthetic_transport: true, real_chrome: true, cases, verified_at: new Date().toISOString() }));
  }
} finally { release?.(); await browser?.close(); await fixture.close(); await rm(cacheDir, { recursive: true, force: true }); }
