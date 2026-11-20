// Optional Chrome acceptance against the RBAC suite's isolated PostgreSQL database.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
export async function inspectEnvironmentRbac({workspace,environment,user,handler,verifySaved,verifyCleared}) {
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const cacheDir=await mkdtemp(path.join(tmpdir(),'flash-roles-fixture-'));
 let browser,failNext=false,holdNext=false,release,originalOrigin=process.env.URL;
 const fixture=await createServer({cacheDir,envDir:false,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','@tanstack/react-query','lucide-react','zustand']},plugins:[{
  name:'synthetic-roles-fixture',resolveId(id){if(id==='virtual:roles-fixture')return id;},
  load(id){if(id==='virtual:roles-fixture')return `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'/src/lib/queryClient.ts';import Roles from'/src/pages/Roles.tsx';import'/src/index.css';createRoot(document.getElementById('app')).render(React.createElement(QueryClientProvider,{client:queryClient},React.createElement(Roles)));`;},
  transform(_code,id){
   if(id.split('?')[0].endsWith('/src/stores/auth.ts'))return `export const useAuthStore=()=>({user:{id:${JSON.stringify(user)},is_superadmin:false}});useAuthStore.getState=()=>({user:{id:${JSON.stringify(user)}}});`;
   if(id.split('?')[0].endsWith('/src/stores/context.ts'))return `export const useContextStore=()=>({activeWorkspace:{id:${JSON.stringify(workspace)},name:'Synthetic workspace',user_role:'member',access_scope:'scoped'},activeEnvironment:{id:${JSON.stringify(environment)},name:'Synthetic environment',user_role:'owner'}});`;
  },
  configureServer(server){server.middlewares.use(async(incoming,outgoing,next)=>{try{
   const url=new URL(incoming.url,fixture.resolvedUrls.local[0]);
   if(url.pathname==='/fixture'){outgoing.setHeader('Content-Type','text/html');outgoing.end(await server.transformIndexHtml('/fixture','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="p-4" id="app"></main><script type="module" src="/@id/virtual:roles-fixture"></script></body></html>'));return;}
   if(url.pathname!=='/api/roles/rbac')return next();
   if(incoming.method==='PUT'&&failNext){failNext=false;outgoing.writeHead(503,{'Content-Type':'application/json'});outgoing.end('{"error":"Synthetic retryable failure"}');return;}
   if(incoming.method==='PUT'&&holdNext){holdNext=false;await new Promise(resolve=>{release=resolve;});}
   let body='';for await(const chunk of incoming){body+=chunk;if(body.length>65536)throw Error('Fixture request budget exceeded');}
   const headers=new Headers();for(const[k,v]of Object.entries(incoming.headers))if(typeof v==='string')headers.set(k,v);headers.set('cookie','flash_session=fixture-'+user);
   const response=await handler(new Request(url.href,{method:incoming.method,headers,...(body?{body}:{})}),{});outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());
  }catch(error){next(error);}});}
 }]});
 try{
  await fixture.listen();const origin=fixture.resolvedUrls.local[0];process.env.URL=origin;browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  const context=await browser.newContext();let blocked=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(origin).origin)return route.continue();blocked++;return route.abort();});
  const page=await context.newPage();
  for(const width of [1100,390]){
   await page.setViewportSize({width,height:950});await page.goto(origin+'fixture');await page.getByText('Environment RBAC override editor.',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Raw Matrix',exact:true}).click();
   assert.equal(await page.getByRole('heading',{name:'Workspace',exact:true}).count(),0);
   const audit=page.locator('section').filter({has:page.getByRole('heading',{name:'Audit',exact:true})});const select=audit.locator('select').first();await select.selectOption('member');
   const save=page.getByRole('button',{name:'Save RBAC',exact:true});assert.equal(await save.isEnabled(),true);
   failNext=true;let response=page.waitForResponse(r=>r.request().method()==='PUT');await save.click();assert.equal((await response).status(),503);await page.getByText('Synthetic retryable failure',{exact:true}).waitFor();assert.equal(await select.inputValue(),'member');
   holdNext=true;response=page.waitForResponse(r=>r.request().method()==='PUT');await save.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Saving...',exact:true}).waitFor();release();assert.equal((await response).status(),200);
   await page.getByText('Environment RBAC permissions updated.',{exact:true}).waitFor();await verifySaved();
   assert.equal(await page.getByRole('heading',{name:'Workspace',exact:true}).count(),0);
   await page.getByRole('button',{name:'Role View',exact:true}).click();await page.getByRole('heading',{name:/^owner$/i}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(process.env.RBAC_SCREENSHOTS){await mkdir(process.env.RBAC_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.RBAC_SCREENSHOTS,'roles-'+width+'.png'),fullPage:true});}
   response=page.waitForResponse(r=>r.request().method()==='DELETE');await page.getByRole('button',{name:'Clear override',exact:true}).click();assert.equal((await response).status(),200);await page.getByText('Environment RBAC override cleared.',{exact:false}).waitFor();await verifyCleared();
  }
  assert.equal(blocked,0);await context.close();console.log(JSON.stringify({browserWidths:2,actualRolesPage:true,actualHooks:true,actualHandler:true,syntheticPostgres:true,externalRequests:blocked}));
 }finally{release?.();if(originalOrigin)process.env.URL=originalOrigin;else delete process.env.URL;await browser?.close();await fixture.close();await rm(cacheDir,{recursive:true,force:true});}
}
