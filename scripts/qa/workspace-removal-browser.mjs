// Optional Chrome acceptance against the membership suite's disposable PostgreSQL fixture.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

export async function inspectWorkspaceRemoval({ workspace, target, handler, checkUnchanged, checkRemoved }) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'flash-remove-vite-'));
  const originalOrigin = process.env.URL;
  let failNextRemoval = false;
  let removalRequests = 0;
  const fixture = await createServer({
    cacheDir, envDir: false,
    optimizeDeps: { include: ['react', 'react-dom/client', '@tanstack/react-query', 'lucide-react'] },
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [{
      name: 'disposable-workspace-removal-fixture',
      resolveId(id) { if (id === 'virtual:workspace-removal-fixture') return id; },
      load(id) {
        if (id !== 'virtual:workspace-removal-fixture') return;
        return `import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
          import Modal from '/src/components/users/UserAccessAssignmentsModal.tsx';
          import '/src/index.css';
          function Fixture(){const[open,setOpen]=React.useState(true);return React.createElement(React.Fragment,null,
            React.createElement('button',{onClick:()=>setOpen(true)},'Open access'),
            React.createElement(Modal,{open,workspaceId:${JSON.stringify(workspace)},userId:${JSON.stringify(target)},
              currentUserRole:'owner',isSuperadmin:true,canManageWorkspaceUsers:true,
              onClose:()=>setOpen(false)}));}
          const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
          createRoot(document.querySelector('#app')).render(React.createElement(QueryClientProvider,{client},React.createElement(Fixture)));`;
      },
      configureServer(server) {
        server.middlewares.use(async (incoming, outgoing, next) => {
          try {
            const url = new URL(incoming.url, fixture.resolvedUrls.local[0]);
            if (url.pathname === '/fixture') {
              outgoing.setHeader('Content-Type', 'text/html');
              outgoing.setHeader('Set-Cookie', 'flash_session=fixture-browser-removal; HttpOnly; SameSite=Strict; Path=/');
              outgoing.end(await server.transformIndexHtml('/fixture', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:workspace-removal-fixture"></script></body></html>'));
              return;
            }
            if (url.pathname === '/api/environments/list') {
              outgoing.setHeader('Content-Type', 'application/json'); outgoing.end('{"environments":[]}'); return;
            }
            if (!url.pathname.startsWith('/api/workspaces/users')) return next();
            if (incoming.method === 'DELETE') {
              removalRequests++;
              if (failNextRemoval) {
                failNextRemoval = false;
                outgoing.writeHead(503, { 'Content-Type': 'application/json' });
                outgoing.end('{"error":"Synthetic retryable failure"}'); return;
              }
            }
            const request = new Request(url.href, { method: incoming.method, headers: incoming.headers });
            const response = await handler(request, {});
            outgoing.writeHead(response.status, Object.fromEntries(response.headers));
            outgoing.end(await response.text());
          } catch (error) { next(error); }
        });
      },
    }],
  });
  try {
    await fixture.listen();
    const base = fixture.resolvedUrls.local[0];
    process.env.URL = new URL(base).origin;
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(new URL('/fixture', base).href);
    const remove = page.getByRole('button', { name: 'Remove User', exact: true });
    const checkbox = page.getByRole('checkbox', { name: /Cancel affected pending invitations/ });
    await remove.waitFor();
    assert.equal(await checkbox.isChecked(), false);
    page.once('dialog', dialog => dialog.accept());
    let response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await remove.click(); assert.equal((await response).status(), 409);
    await page.getByText('Pending invitations could restore access.', { exact: false }).waitFor();
    await checkUnchanged();

    await checkbox.focus(); await page.keyboard.press('Space');
    assert.equal(await checkbox.isChecked(), true);
    page.once('dialog', dialog => dialog.dismiss());
    await remove.click(); assert.equal(removalRequests, 1);
    await checkUnchanged();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await remove.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open access' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('label')]
      .find(label => label.textContent.includes('Cancel affected pending invitations'))
      ?.querySelector('input')?.checked === false);
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.focus(); await page.keyboard.press('Space');
    failNextRemoval = true;
    page.once('dialog', dialog => dialog.accept());
    response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await remove.click(); assert.equal((await response).status(), 503);
    await page.getByText('Synthetic retryable failure').waitFor();
    assert.equal(await checkbox.isChecked(), true);
    await checkUnchanged();

    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.getByText('Effective access before and after saving', { exact: true }).click();
      await page.getByText('Direct roles take precedence over inherited roles.', { exact: false }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.REMOVAL_SCREENSHOTS) {
        await mkdir(process.env.REMOVAL_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.REMOVAL_SCREENSHOTS, 'remove-' + width + '.png'), fullPage: true });
      }
      await page.getByText('Effective access before and after saving', { exact: true }).click();
    }
    page.once('dialog', dialog => dialog.accept());
    response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await remove.focus(); await page.keyboard.press('Enter');
    assert.equal((await response).status(), 200);
    await remove.waitFor({ state: 'hidden' });
    await checkRemoved();
    assert.equal(removalRequests, 3);
    await page.close();
  } finally {
    if (originalOrigin) process.env.URL = originalOrigin; else delete process.env.URL;
    await fixture.close(); await browser.close(); await rm(cacheDir, { recursive: true, force: true });
  }
}
