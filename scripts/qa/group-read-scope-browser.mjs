// Read-only UI acceptance over actual handlers and disposable synthetic records.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
export async function inspectGroupReadScope({handlers,session,environment,otherEnvironment,parent}){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const cacheDir=await mkdtemp(path.join(tmpdir(),'flash-group-read-'));
 let browser,reads=0,writes=0,external=0,fail=false;
 const fixture=await createServer({cacheDir,envDir:false,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react-router','@tanstack/react-query','zustand','lucide-react','clsx']},plugins:[{
  name:'synthetic-group-reads',resolveId(id){if(id==='virtual:group-reads')return id;},
  load(id){if(id!=='virtual:group-reads')return;return `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'/src/lib/queryClient.ts';import{useContextStore}from'/src/stores/context.ts';import Devices from'/src/pages/Devices.tsx';import Groups from'/src/pages/Groups.tsx';import Policies from'/src/pages/Policies.tsx';import'/src/index.css';useContextStore.setState({activeWorkspace:{id:'synthetic-workspace',name:'Synthetic workspace',access_scope:'scoped'},activeEnvironment:{id:${JSON.stringify(environment)},name:'Synthetic current'},groups:[]});window.groupFixtureScope=(id,group)=>useContextStore.setState({activeEnvironment:{id,name:'Synthetic changed'},activeGroup:group?{id:group,name:'Permitted parent'}:null});function Fixture(){return React.createElement(QueryClientProvider,{client:queryClient},React.createElement(BrowserRouter,null,React.createElement('nav',{className:'flex gap-4 mb-4'},...['devices','groups','policies'].map(name=>React.createElement(Link,{key:name,to:'/fixture/'+name},name))),React.createElement(Routes,null,React.createElement(Route,{path:'/fixture/devices',element:React.createElement(Devices)}),React.createElement(Route,{path:'/fixture/groups',element:React.createElement(Groups)}),React.createElement(Route,{path:'/fixture/policies',element:React.createElement(Policies)}))));}createRoot(document.getElementById('app')).render(React.createElement(Fixture));`;},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname.startsWith('/fixture/')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/fixture','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:group-reads"></script></body></html>'));return;}
   if(!url.pathname.startsWith('/api/'))return next();if(req.method!=='GET')writes++;reads++;
   if(fail){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Synthetic unavailable"}');return;}
   const handler=Object.entries(handlers).find(([prefix])=>url.pathname.startsWith(prefix))?.[1];if(!handler){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Unregistered synthetic read"}');return;}
   const response=await handler(new Request('http://localhost'+url.pathname+url.search,{headers:{cookie:'flash_session='+session}}),{});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());
  }catch(error){next(error);}});},
 }]});
 try{
  await fixture.listen();const origin=fixture.resolvedUrls.local[0];browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  for(const width of [1100,390]){
   const context=await browser.newContext({viewport:{width,height:950}});await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(origin).origin)return route.continue();external++;return route.abort();});const page=await context.newPage();
   await page.goto(origin+'fixture/devices');await page.getByRole('cell',{name:'Synthetic regained',exact:true}).waitFor();
   for(const name of ['weak','inherited','low','ungrouped'])assert.equal(await page.getByRole('cell',{name:'Synthetic '+name,exact:true}).count(),0);
   assert.equal(await page.locator('option[value="Maker weak"]').count(),0);await page.evaluate(({env,parent})=>window.groupFixtureScope(env,parent),{env:environment,parent});
   await page.waitForFunction(()=>document.body.innerText.replace(/\s+/g,' ').includes('Showing 1 - 3 of 3'));assert.equal(await page.getByRole('cell',{name:'Synthetic high',exact:true}).count(),0);
   const maker=page.locator('select').filter({has:page.locator('option[value="Maker regained"]')});await maker.selectOption('Maker regained');await page.waitForFunction(()=>document.body.innerText.replace(/\s+/g,' ').includes('Showing 1 - 1 of 1'));
   if(process.env.GROUP_SCOPE_SCREENSHOTS){await mkdir(process.env.GROUP_SCOPE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.GROUP_SCOPE_SCREENSHOTS,'devices-'+width+'.png'),fullPage:true});}
   await page.getByRole('link',{name:'groups',exact:true}).click();await page.getByRole('cell',{name:'regained',exact:true}).waitFor();for(const name of ['weak','inherited','low'])assert.equal(await page.getByRole('cell',{name,exact:true}).count(),0);
   await page.getByRole('link',{name:'policies',exact:true}).click();const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Shared synthetic policy',exact:true})});await row.waitFor();assert.equal(await row.getByRole('cell',{name:'4',exact:true}).count(),1);
   await page.getByRole('link',{name:'devices',exact:true}).click();await page.evaluate(id=>window.groupFixtureScope(id,null),otherEnvironment);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('cell',{name:'Synthetic regained',exact:true}).count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
   fail=true;const fault=await browser.newPage({viewport:{width,height:950}});await fault.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());await fault.goto(origin+'fixture/devices');await fault.getByRole('alert').waitFor();fail=false;await fault.getByRole('button',{name:'Retry',exact:true}).click();await fault.getByRole('cell',{name:'Synthetic regained',exact:true}).waitFor();await fault.close();
  }
  assert.equal(writes,0);assert.equal(external,0);console.log(JSON.stringify({actualPages:['Devices','Groups','Policies'],actualHandlers:true,actualHooks:true,syntheticPostgres:true,widths:2,reads,writes,externalRequests:external}));
 }finally{await browser?.close();await fixture.close();await rm(cacheDir,{recursive:true,force:true});}
}
