// Actual page/hooks and QR renderer, with inert loopback rows and clipboard.
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const cacheDir=await mkdtemp(path.join(tmpdir(),'flash-enrolment-details-'));
let browser,release,mode='normal',reads=0,writes=0,blocked=0;
const token=(id='one')=>({id,environment_id:'inert-environment',name:'Synthetic '+id,value:'inert-value-'+id,qr_data:'inert-qr-'+id,created_at:'2026-11-21T09:00:00Z'});
const fixture=await createServer({cacheDir,envDir:false,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','@tanstack/react-query','lucide-react','zustand','qrcode']},plugins:[{
 name:'inert-enrolment-details',resolveId(id){if(id==='virtual:enrolment-details')return id;},
 load(id){if(id!=='virtual:enrolment-details')return;return `import React from'react';import{createRoot}from'react-dom/client';import{QueryClientProvider}from'@tanstack/react-query';import{queryClient}from'/src/lib/queryClient.ts';import EnrollmentTokens from'/src/pages/EnrollmentTokens.tsx';import{useAuthStore}from'/src/stores/auth.ts';import{useContextStore}from'/src/stores/context.ts';import'/src/index.css';
 useAuthStore.setState({user:{id:'inert-operator',is_superadmin:false}});useContextStore.setState({activeWorkspace:{id:'inert-workspace',name:'Synthetic workspace',user_role:'owner',access_scope:'workspace'},activeEnvironment:{id:'inert-environment',name:'Synthetic environment',enterprise_name:'enterprises/inert',user_role:'owner'}});
 window.inertClipboard=[];window.copyMode='success';navigator.clipboard.writeText=value=>{window.inertClipboard.push(value);if(window.copyMode==='failure')return Promise.reject(Error('Synthetic clipboard failure'));if(window.copyMode==='hold')return new Promise(resolve=>window.finishCopy=resolve);return Promise.resolve();};
 function Fixture(){return React.createElement(React.Fragment,null,React.createElement('nav',{className:'flex gap-2 mb-4'},
 React.createElement('button',{onClick:()=>queryClient.invalidateQueries({queryKey:['enrollment']})},'Refresh fixture'),
 React.createElement('button',{onClick:()=>{const u=useAuthStore.getState().user;useAuthStore.setState({user:{...u,id:u.id==='inert-operator'?'inert-second':'inert-operator'}});}},'Switch identity'),
 React.createElement('button',{onClick:()=>{const e=useContextStore.getState().activeEnvironment;useContextStore.setState({activeEnvironment:{...e,id:e.id==='inert-environment'?'inert-other':'inert-environment'}});}},'Switch environment')),React.createElement(EnrollmentTokens));}
 createRoot(document.getElementById('app')).render(React.createElement(QueryClientProvider,{client:queryClient},React.createElement(Fixture)));`;},
 transform(_code,id){if(id.split('?')[0].endsWith('/src/components/enrollment/TokenCreator.tsx'))return 'export default function TokenCreator(){return null;}';},
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/fixture','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="p-4"></main><script type="module" src="/@id/virtual:enrolment-details"></script></body></html>'));return;}
  if(!url.pathname.startsWith('/api/'))return next();
  if(req.method!=='GET')writes++;
  if(url.pathname!=='/api/enrolment/list'){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Inert fixture only"}');return;}
  reads++;if(mode==='hold')await new Promise(yes=>{release=yes;});
  const denied=mode==='denied';res.writeHead(denied?403:200,{'Content-Type':'application/json'});
  res.end(JSON.stringify(denied?{error:'Synthetic access denied'}:{tokens:mode==='empty'||url.searchParams.get('environment_id')!=='inert-environment'?[]:[token(),token('two')]}));
 });},
}]});
try{
 await fixture.listen();const origin=fixture.resolvedUrls.local[0];browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 for(const width of [1100,390]){
  const context=await browser.newContext({viewport:{width,height:950}});await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(origin).origin)return route.continue();blocked++;return route.abort();});
  const page=await context.newPage();mode='hold';await page.goto(origin+'fixture');await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Enrolment Tokens'));while(!release)await new Promise(r=>setTimeout(r,10));mode='normal';release();
  const row=()=>page.getByRole('button',{name:'Open enrolment token Synthetic one',exact:true});
  await row().waitFor();await row().focus();await page.keyboard.press('Enter');
  const dialog=()=>page.getByRole('dialog',{name:'Enrolment token details'});
  const control=async name=>page.getByRole('button',{name,exact:true}).evaluate(el=>el.click());
  await dialog().getByText('inert-value-one',{exact:true}).waitFor();await dialog().getByRole('img',{name:'Enrolment token QR code'}).waitFor();
  assert.equal(await dialog().getByRole('button',{name:'Close token viewer'}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await dialog().getByRole('button',{name:'Copy QR payload'}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await dialog().getByRole('button',{name:'Copy token value'}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Enter');await dialog().getByText('Copied',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.inertClipboard),['inert-value-one']);
  await page.evaluate(()=>window.copyMode='failure');await dialog().getByRole('button',{name:'Copy QR payload'}).click();await dialog().getByRole('alert').waitFor();
  if(process.env.ENROLMENT_SCREENSHOTS){await mkdir(process.env.ENROLMENT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.ENROLMENT_SCREENSHOTS,'drawer-'+width+'.png'),fullPage:true});}
  assert.ok(await dialog().evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.keyboard.press('Escape');assert.equal(await dialog().count(),0);
  await row().click();mode='hold';await control('Refresh fixture');await dialog().waitFor({state:'detached'});mode='normal';release();await row().waitFor();assert.equal(await dialog().count(),0);
  await row().click();mode='empty';await control('Refresh fixture');await page.getByText('No enrolment tokens',{exact:true}).waitFor();assert.equal(await dialog().count(),0);
  mode='normal';await control('Refresh fixture');await row().click();await control('Switch identity');await dialog().waitFor({state:'detached'});await row().waitFor();
  await row().click();mode='denied';await control('Refresh fixture');await dialog().waitFor({state:'detached'});await page.getByText('Synthetic access denied',{exact:true}).waitFor();assert.equal(await page.getByText('inert-value-one',{exact:true}).count(),0);
  mode='normal';await page.getByRole('button',{name:'Retry',exact:true}).click();await row().click();await control('Switch environment');await page.getByText('No enrolment tokens',{exact:true}).waitFor();assert.equal(await dialog().count(),0);
  await context.close();
 }
 assert.equal(blocked,0);assert.equal(writes,0);console.log(JSON.stringify({actualPage:true,actualHooks:true,actualQrRenderer:true,widths:2,syntheticReads:reads,writes,externalRequests:blocked}));
}finally{release?.();await browser?.close();await fixture.close();await rm(cacheDir,{recursive:true,force:true});}
