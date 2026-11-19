// Optional local Chrome acceptance for the PostgreSQL user-controls fixture.
// Supply PLAYWRIGHT_MODULE and CHROME_PATH to the fixture's Vitest process.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

export async function inspectUserManagement({ actor, workspace, env, child, handlers, allowEnvironmentManager, removeActorGrants }) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const cacheDir = await mkdtemp(path.join(tmpdir(),'flash-invite-vite-'));
  const originalOrigin = process.env.URL;
  const fixture = await createServer({
    cacheDir, envDir: false,
    optimizeDeps: { include: ['react', 'react-dom/client', '@tanstack/react-query', 'zustand', 'lucide-react', 'clsx'] },
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [{
      name: 'disposable-user-controls-fixture',
      resolveId(id) { if (id === 'virtual:user-controls-fixture') return id; },
      load(id) {
        if (id !== 'virtual:user-controls-fixture') return;
        return `                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
                import Users from '/src/pages/Users.tsx';
                import { useAuthStore } from '/src/stores/auth.ts';
                import { useContextStore } from '/src/stores/context.ts';
                import '/src/index.css';
                useAuthStore.setState({user:{id:${JSON.stringify(actor)},email:'actor@example.invalid',is_superadmin:false}});
                useContextStore.setState({activeWorkspace:{id:${JSON.stringify(workspace)},name:'Invite fixture',access_scope:'scoped'},
                  activeEnvironment:{id:${JSON.stringify(env)},workspace_id:${JSON.stringify(workspace)},name:'Invite environment',user_role:'owner'},activeGroup:null});
                const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
                createRoot(document.querySelector('#app')).render(React.createElement(QueryClientProvider,{client},React.createElement(Users)));
`;
      },
      configureServer(server) {
        server.middlewares.use(async (incoming, outgoing, next) => {
          try {
            const url = new URL(incoming.url, fixture.resolvedUrls.local[0]);
            if (url.pathname === '/fixture') {
              // The normal components, CSS, stores and API queries all run in Chrome.
              const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
                <body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:user-controls-fixture"></script></body></html>`;
              outgoing.setHeader('Content-Type', 'text/html');
              outgoing.setHeader('Set-Cookie', 'flash_session=fixture-invite-only; HttpOnly; SameSite=Strict; Path=/');
              outgoing.end(await server.transformIndexHtml('/fixture', page));
              return;
            }
            const handler = handlers[url.pathname];
            if (!handler) return next();
            const data = [];
            for await (const part of incoming) data.push(part);
            const req = new Request(url.href, { method: incoming.method, headers: incoming.headers, body: data.length ? Buffer.concat(data) : undefined });
            const result = await handler(req, {});
            outgoing.writeHead(result.status, Object.fromEntries(result.headers));
            outgoing.end(await result.text());
          } catch (error) { next(error); }
        });
      },
    }],
  });
  try {
    await fixture.listen();
    const base = fixture.resolvedUrls.local[0];
    process.env.URL = new URL(base).origin;
    async function newPage(width) {
      const page = await browser.newPage({ viewport: { width, height: 920 } });
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        return target.hostname === '127.0.0.1' || target.hostname === 'localhost' ? route.continue() : route.abort();
      });
      return page;
    }
    async function screenshot(page,name) {
      if (!process.env.USER_CONTROLS_SCREENSHOTS) return;
      await mkdir(process.env.USER_CONTROLS_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:path.join(process.env.USER_CONTROLS_SCREENSHOTS,name+'.png')});
    }
    for (const width of [1100,390]) {
      const page = await newPage(width);
      await page.goto(new URL('/fixture', base).href);
      const open = page.getByRole('button',{name:'Invite User'});
      await open.waitFor();
      assert.equal(await page.getByRole('button',{name:'Manage Access'}).count(),0);
      await open.focus();
      await page.keyboard.press('Enter');
      const panel = page.getByRole('dialog',{name:'Invite User'});
      const email = panel.getByLabel('Email');
      assert.equal(await email.evaluate(element => element === document.activeElement),true);
      assert.equal(await panel.getByRole('radio',{name:/^workspace-wide/i}).isDisabled(),true);
      assert.equal(await panel.getByRole('radio',{name:/^current environment/i}).isDisabled(),true);
      assert.equal(await panel.getByRole('radio',{name:/^specific group/i}).isChecked(),true);
      const children = panel.getByLabel('Invite group');
      assert.deepEqual((await children.locator('option').allTextContents()).map(text => text.trim()),['Managed parent','Managed child']);
      await children.selectOption(child);
      await email.fill('browser-' + width + '@example.invalid');
      await panel.getByLabel('Role').selectOption('admin');
      assert.equal(await panel.getByLabel('Role').locator('option[value="owner"]').count(),0);
      const send = panel.getByRole('button',{name:'Send Invite'});
      await send.focus(); await page.keyboard.press('Tab');
      assert.equal(await panel.getByRole('button',{name:'Close invite'}).evaluate(e => e===document.activeElement),true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await send.evaluate(e => e===document.activeElement),true);
      const bounds = await panel.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await screenshot(page,'invite-'+width);
      const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspaces/invite');
      await page.keyboard.press('Enter');
      assert.equal((await sent).status(),201);
      await panel.waitFor({state:'hidden'});
      assert.equal(await open.evaluate(e => e===document.activeElement),true);
      await open.press('Space'); await panel.waitFor(); await page.keyboard.press('Escape');
      await panel.waitFor({state:'hidden'});
      await page.close();
    }
    await allowEnvironmentManager();
    const manager = await newPage(1100);
    await manager.goto(new URL('/fixture',base).href);
    await manager.getByRole('button',{name:'Manage Access'}).first().click();
    await manager.getByText('Scoped to the active environment only.').waitFor();
    assert.equal(await manager.getByRole('option',{name:'Owner', exact:true}).count(),0);
    assert.equal(await manager.getByRole('radio',{name:/Workspace-wide access/}).count(),0);
    await screenshot(manager,'manage-access-1100');
    await manager.close();

    const failed = await newPage(390);
    let unblock;
    const hold = new Promise(resolve => { unblock = resolve; });
    await failed.route(url => url.pathname === '/api/workspaces/users' && url.searchParams.get('view') === 'controls', async route => {
      await hold;
      await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic unavailable"}'});
    });
    await failed.goto(new URL('/fixture',base).href,{waitUntil:'domcontentloaded'});
    await failed.getByRole('heading',{name:'Users'}).waitFor();
    assert.equal(await failed.getByRole('button',{name:'Manage Access'}).count(),0);
    assert.equal(await failed.getByRole('button',{name:'Invite User'}).count(),0);
    unblock();
    await failed.getByText('Unable to load user management permissions.').waitFor();
    assert.equal(await failed.getByRole('button',{name:'Manage Access'}).count(),0);
    await screenshot(failed,'controls-error-390');
    await failed.close();

    await removeActorGrants();
    const empty = await newPage(390);
    await empty.goto(new URL('/fixture',base).href);
    await empty.getByText('No users scoped to this environment.').waitFor();
    assert.equal(await empty.getByRole('button',{name:'Invite User'}).count(),0);
    assert.equal(await empty.getByRole('button',{name:'Manage Access'}).count(),0);
    await screenshot(empty,'controls-empty-390');
    await empty.close();
  } finally { if (originalOrigin) process.env.URL = originalOrigin; else delete process.env.URL; await fixture.close(); await browser.close(); await rm(cacheDir,{recursive:true,force:true}); }
}
