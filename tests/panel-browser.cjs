'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/User/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'docs/simplified/evidence');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const file=url.pathname.endsWith('orders.css')?path.join(root,'owner/orders.css'):path.join(evidence,url.searchParams.has('id')?'panel-detail.html':'panel-list.html');
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/html; charset=utf-8');fs.createReadStream(file).pipe(res);
});
(async()=>{
 for(const file of ['panel-list.html','panel-detail.html'])if(!fs.existsSync(path.join(evidence,file)))throw Error('Run isolated PHP/MySQL tests first');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.goto(origin+'/owner/orders.php');
   await page.waitForSelector('.request');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'list horizontal overflow');
   assert(await page.locator('select[name=type]').isVisible());
   await page.screenshot({path:path.join(evidence,'panel-list-'+width+'.png'),fullPage:true});
   await page.locator('.request').first().click();await page.waitForSelector('.phone');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'detail horizontal overflow');
   assert((await page.locator('.phone').getAttribute('href')).startsWith('tel:+7'));
   assert.equal(await page.locator('script,img').count(),0);
   await page.screenshot({path:path.join(evidence,'panel-detail-'+width+'.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(evidence,'panel-browser.json'),JSON.stringify({viewports:[390,1280],list:true,detail:true,noHorizontalOverflow:true,externalRequests:false,mode:'HTML rendered by isolated PHP with synthetic data; authentication tested separately'},null,2));
  console.log('PASS owner panel list/detail at 390 and 1280px, phone link, no scripts/images/external network');
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
