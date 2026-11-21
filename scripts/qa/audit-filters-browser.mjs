// Actual page, hooks, authenticated handler and disposable PostgreSQL records.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
export async function inspectAuditFilters({handler,session,memberSession,environment,sibling,foreign,samples}){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const cacheDir=await mkdtemp(path.join(tmpdir(),'flash-audit-filter-'));
 let browser,release,hold=false,fail=false,actor=session,reads=0,writes=0,external=0;
 const fixture=await createServer({cacheDir,envDir:false,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','@tanstack/react-query','zustand','lucide-react','clsx']},plugins:[{
  name:'synthetic-audit-filters',resolveId(id){if(id==='virtual:audit-filters')return id;},
  load(id){if(id!=='virtual:audit-filters')return;return `import React from'react';import{createRoot}from'react-dom/client';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'/src/lib/queryClient.ts';import AuditLog from'/src/pages/AuditLog.tsx';import{useContextStore}from'/src/stores/context.ts';import'/src/index.css';useContextStore.setState({activeEnvironment:{id:${JSON.stringify(environment)},name:'Synthetic current'}});window.filterRefresh=()=>queryClient.invalidateQueries({queryKey:['audit']});window.filterScope=id=>useContextStore.setState({activeEnvironment:{id,name:'Synthetic changed'}});createRoot(document.getElementById('app')).render(React.createElement(QueryClientProvider,{client:queryClient},React.createElement(AuditLog)));`;},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/fixture','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:audit-filters"></script></body></html>'));return;}
   if(!url.pathname.startsWith('/api/'))return next();if(req.method!=='GET')writes++;reads++;
   if(hold)await new Promise(resolve=>{release=resolve;});
   if(fail){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Synthetic refresh failure"}');return;}
   const response=await handler(new Request('http://localhost'+url.pathname+url.search,{headers:{cookie:'flash_session='+actor}}),{});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());
  }catch(error){next(error);}});},
 }]});
 try{
  await fixture.listen();const origin=fixture.resolvedUrls.local[0];browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  for(const width of [1100,390]){
   actor=session;hold=true;release=undefined;const context=await browser.newContext({viewport:{width,height:950}});await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(origin).origin)return route.continue();external++;return route.abort();});
   const page=await context.newPage();await page.goto(origin+'fixture');await page.getByRole('heading',{name:'Audit Log'}).waitFor();while(!release)await new Promise(r=>setTimeout(r,10));assert.equal(await page.getByLabel(/^Live page\./).count(),0);hold=false;release();
   await page.getByRole('cell',{name:'future_product.action',exact:true}).waitFor();const select=page.getByLabel('Filter audit action');
   await page.getByRole('button',{name:'2',exact:true}).click();await page.getByRole('cell',{name:'device.enrolled',exact:true}).waitFor();
   for(const [id,action] of Object.entries(samples)){await select.selectOption('family:'+id);await page.getByRole('cell',{name:action==='workflow.custom_audit'?'Custom workflow audit':action,exact:true}).first().waitFor();}
   await select.selectOption('exact');const exact=page.getByLabel('Exact audit action');await exact.fill('future_product.action');await exact.press('Enter');await page.getByRole('cell',{name:'future_product.action',exact:true}).waitFor();
   const before=reads;await exact.fill('future_product.other');await page.waitForTimeout(100);assert.equal(reads,before);await exact.press('Enter');await page.getByText('No audit entries found.',{exact:true}).waitFor();
   await exact.fill('private workflow text%');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(reads,before+1);
   if(process.env.AUDIT_FILTER_SCREENSHOTS){await mkdir(process.env.AUDIT_FILTER_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.AUDIT_FILTER_SCREENSHOTS,'exact-'+width+'.png'),fullPage:true});}
   const layout=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,form:[...document.querySelectorAll('form')].map(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,basis:getComputedStyle(el).flexBasis})),select:[...document.querySelectorAll('select')].map(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left}))}));
   assert.ok(layout.document<=layout.viewport+1,JSON.stringify(layout));
   await select.selectOption('family:devices');await page.getByRole('cell',{name:'device.enrolled',exact:true}).waitFor();
   await page.evaluate(id=>window.filterScope(id),sibling);await page.getByRole('cell',{name:'device.command.lock',exact:true}).waitFor();assert.equal(await select.inputValue(),'');
   await page.evaluate(id=>window.filterScope(id),foreign);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('table').count(),0);assert.equal(await page.getByLabel(/^Live page\./).count(),0);
   await page.evaluate(id=>window.filterScope(id),environment);await page.getByRole('cell',{name:'future_product.action',exact:true}).waitFor();
   fail=true;await page.evaluate(()=>window.filterRefresh());await page.getByRole('alert').waitFor();await page.waitForFunction(()=>document.querySelector('button[aria-label="Retry audit log"]')?.disabled===false);fail=false;await page.getByRole('button',{name:'Retry audit log'}).focus();await page.keyboard.press('Enter');await page.getByRole('cell',{name:'future_product.action',exact:true}).waitFor();
   actor=memberSession;await select.selectOption('family:device_commands');await page.waitForFunction(()=>document.body.innerText.replace(/\s+/g,' ').includes('Showing 1 - 3 of 3'));assert.equal(await page.getByRole('cell',{name:'device.command.lock',exact:true}).count(),1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
  }
  assert.equal(writes,0);assert.equal(external,0);console.log(JSON.stringify({actualPage:true,actualHooks:true,actualHandler:true,syntheticPostgres:true,widths:2,reads,writes,externalRequests:external}));
 }finally{release?.();await browser?.close();await fixture.close();await rm(cacheDir,{recursive:true,force:true});}
}
