// Real components/hooks and synthetic loopback responses. Never calls a live key endpoint.
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cacheDir = await mkdtemp(path.join(tmpdir(), 'flash-key-handoff-'));
let browser, release, nextMode = 'success', creates = 0, revocations = 0;
const fixture = await createServer({
  cacheDir, envDir: false,
  server: {host: '127.0.0.1', port: 0, hmr: false},
  optimizeDeps: {include: ['react', 'react-dom/client', '@tanstack/react-query', 'zustand', 'lucide-react']},
  plugins: [{
    name: 'inert-key-handoff-fixture',
    resolveId(id) { if (id === 'virtual:key-handoff') return id; },
    load(id) {
      if (id !== 'virtual:key-handoff') return;
      return `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'/src/lib/queryClient.ts';import{ApiTab}from'/src/pages/Settings.tsx';import'/src/index.css';
      const initial=()=>({user:{id:'inert-user-one',is_superadmin:false},activeWorkspace:{id:'inert-workspace-one',name:'Synthetic workspace one',user_role:'owner',access_scope:'workspace',settings:{}},activeEnvironment:{id:'inert-environment-one',name:'Synthetic environment one',user_role:'owner'},environments:[]});
      window.fixtureState=initial();
      function Fixture(){const[,render]=React.useState(0);const change=fn=>{fn(window.fixtureState);render(n=>n+1);};return React.createElement(React.Fragment,null,
        React.createElement('nav',{className:'flex flex-wrap gap-2 mb-4'},
          React.createElement('button',{onClick:()=>change(s=>{const second=s.activeWorkspace.id==='inert-workspace-one';s.activeWorkspace={...s.activeWorkspace,id:second?'inert-workspace-two':'inert-workspace-one',name:second?'Synthetic workspace two':'Synthetic workspace one'};s.activeEnvironment={...s.activeEnvironment,id:second?'inert-environment-three':'inert-environment-one',name:second?'Synthetic environment three':'Synthetic environment one'};})},'Switch workspace'),
          React.createElement('button',{onClick:()=>change(s=>{const second=s.activeEnvironment.id==='inert-environment-one';s.activeEnvironment={...s.activeEnvironment,id:second?'inert-environment-two':'inert-environment-one',name:second?'Synthetic environment two':'Synthetic environment one'};})},'Switch environment'),
          React.createElement('button',{onClick:()=>change(s=>{s.user={...s.user,id:s.user.id==='inert-user-one'?'inert-user-two':'inert-user-one'};})},'Switch identity'),
          React.createElement('button',{onClick:()=>change(s=>{const role=s.activeWorkspace.user_role==='owner'?'viewer':'owner';s.activeWorkspace={...s.activeWorkspace,user_role:role};s.activeEnvironment={...s.activeEnvironment,user_role:role};})},'Toggle access'),
          React.createElement('button',{onClick:()=>change(s=>{s.activeEnvironment={...s.activeEnvironment,user_role:s.activeEnvironment.user_role==='owner'?'admin':'owner'};})},'Toggle role ceiling')),
        React.createElement(ApiTab));}
      createRoot(document.getElementById('app')).render(React.createElement(QueryClientProvider,{client:queryClient},React.createElement(Fixture)));`;
    },
    transform(_code, id) {
      if (id.split('?')[0].endsWith('/src/stores/auth.ts')) return `export const useAuthStore=()=>({user:window.fixtureState.user});useAuthStore.getState=()=>({user:window.fixtureState.user});`;
      if (id.split('?')[0].endsWith('/src/stores/context.ts')) return `export const useContextStore=()=>window.fixtureState;useContextStore.getState=()=>window.fixtureState;`;
    },
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        try {
          const url = new URL(incoming.url, fixture.resolvedUrls.local[0]);
          if (url.pathname === '/fixture') {
            outgoing.setHeader('Content-Type', 'text/html');
            outgoing.end(await server.transformIndexHtml('/fixture', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="p-4" id="app"></main><script type="module" src="/@id/virtual:key-handoff"></script></body></html>'));
            return;
          }
          if (!url.pathname.startsWith('/api/api-keys/')) return next();
          outgoing.setHeader('Content-Type', 'application/json');
          if (url.pathname.endsWith('/list')) { outgoing.end('{"api_keys":[]}'); return; }
          if (url.pathname.endsWith('/revoke')) { revocations++; throw Error('A handoff check must never revoke a key'); }
          assert.equal(url.pathname, '/api/api-keys/create');
          let body = '';
          for await (const chunk of incoming) { body += chunk; assert.ok(body.length < 65536); }
          const input = JSON.parse(body), mode = nextMode, number = ++creates;
          nextMode = 'success';
          const workspace = input.workspace_id || (input.environment_id === 'inert-environment-three' ? 'inert-workspace-two' : 'inert-workspace-one');
          if (mode.startsWith('hold')) await new Promise(resolve => { release = resolve; });
          if (mode === 'hold-error') { outgoing.writeHead(503); outgoing.end('{"error":"Inert old-scope failure"}'); return; }
          outgoing.writeHead(201);
          outgoing.end(JSON.stringify({api_key: {id: 'inert-record-' + number, name: input.name, scope_type: input.scope_type, workspace_id: workspace, environment_id: input.environment_id || null, role: input.role, token: 'inert-one-time-value-' + number, token_prefix: 'inert', expires_at: null}}));
        } catch (error) { next(error); }
      });
    },
  }],
});
try {
  await fixture.listen();
  const origin = fixture.resolvedUrls.local[0];
  browser = await chromium.launch({executablePath: process.env.CHROME_PATH, headless: true});
  let blocked = 0;
  for (const width of [1100, 390]) {
    const context = await browser.newContext({viewport: {width, height: 950}});
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
      blocked++; return route.abort();
    });
    await context.addInitScript(() => {
      window.inertClipboard = []; window.failInertClipboard = false;
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => {
        if (window.failInertClipboard) throw Error('Inert clipboard failure');
        window.inertClipboard.push(value);
      }}});
    });
    const page = await context.newPage();
    await page.goto(origin + 'fixture');
    const workspaceInput = page.getByPlaceholder('Local integration (workspace-wide)');
    const environmentInput = page.getByPlaceholder('Local integration (environment)', {exact: true});
    async function generate(input) {
      const before = creates;
      await input.fill('Synthetic handoff');
      const form = input.locator('xpath=ancestor::form');
      await form.getByRole('button', {name: 'Generate API Key', exact: true}).focus();
      await page.keyboard.press('Enter');
      for (let attempt = 0; creates === before && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(creates, before + 1);
    }
    async function shot(name) {
      if (!process.env.KEY_HANDOFF_SCREENSHOTS) return;
      await mkdir(process.env.KEY_HANDOFF_SCREENSHOTS, {recursive: true});
      await page.screenshot({path: path.join(process.env.KEY_HANDOFF_SCREENSHOTS, name + '-' + width + '.png'), fullPage: true});
    }
    await workspaceInput.waitFor();
    await generate(workspaceInput); const first = creates;
    await page.getByText('inert-one-time-value-' + first, {exact: true}).waitFor();
    const handoff = page.getByText('New API key (shown once)', {exact: true}).locator('..');
    await handoff.getByRole('button', {name: 'Copy', exact: true}).focus(); await page.keyboard.press('Enter');
    await page.getByText('Copied API key "Synthetic handoff" to clipboard.', {exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.inertClipboard), ['inert-one-time-value-' + first]);
    await page.evaluate(() => { window.failInertClipboard = true; });
    await handoff.getByRole('button', {name: 'Copy', exact: true}).click();
    await page.getByText('Unable to copy the API key. Select and copy the value manually.', {exact: true}).waitFor();
    await shot('copy-error');
    await page.getByRole('button', {name: 'Switch environment', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + first, {exact: true}).count(), 1);
    await generate(environmentInput); const environmentValue = creates;
    await page.getByText('inert-one-time-value-' + environmentValue, {exact: true}).waitFor();
    await shot('same-context-success');
    await page.getByRole('button', {name: 'Switch environment', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + environmentValue, {exact: true}).count(), 0);
    await page.getByRole('button', {name: 'Switch environment', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + environmentValue, {exact: true}).count(), 0);
    await page.getByRole('button', {name: 'Switch identity', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + first, {exact: true}).count(), 0);
    nextMode = 'hold'; await generate(environmentInput); const delayed = creates;
    await page.getByText(/Leaving dismisses its one-time value/).waitFor(); await shot('pending');
    await page.getByRole('button', {name: 'Switch workspace', exact: true}).click();
    const delivered = page.waitForResponse(r => r.request().method() === 'POST' && r.status() === 201); release(); await delivered;
    assert.equal(await page.getByText('inert-one-time-value-' + delayed, {exact: true}).count(), 0);
    await page.getByRole('button', {name: 'Switch workspace', exact: true}).click();
    await page.getByRole('button', {name: 'Switch environment', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + delayed, {exact: true}).count(), 0);
    nextMode = 'hold-error'; await generate(environmentInput);
    await page.getByText(/Leaving dismisses its one-time value/).waitFor();
    await page.getByRole('button', {name: 'Toggle access', exact: true}).click();
    const failed = page.waitForResponse(r => r.request().method() === 'POST' && r.status() === 503); release(); await failed;
    assert.equal(await page.getByText('Inert old-scope failure', {exact: true}).count(), 0);
    await page.getByRole('button', {name: 'Toggle access', exact: true}).click();
    await generate(environmentInput); const ceilingValue = creates;
    await page.getByText('inert-one-time-value-' + ceilingValue, {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Toggle role ceiling', exact: true}).click();
    assert.equal(await page.getByText('inert-one-time-value-' + ceilingValue, {exact: true}).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await context.close();
  }
  assert.equal(blocked, 0); assert.equal(revocations, 0);
  console.log(JSON.stringify({widths: 2, actualApiTabAndPanels: true, actualHooks: true, inertTransportOnly: true, externalRequests: blocked, revocations, syntheticCreates: creates}));
} finally {
  release?.(); await browser?.close(); await fixture.close(); await rm(cacheDir, {recursive: true, force: true});
}
