'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/User/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');fs.createReadStream(f).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});
   for(const name of ['legal','consent','returns']){
    await page.goto(origin+'/'+name+'.html');
    assert.equal(await page.locator('h1').count(),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow: '+name);
    const text=await page.locator('main').innerText();
    assert(text.includes('27.10.2026')&&text.includes('временно отключён'));
    assert(!text.includes('Условия публикации')&&!text.includes('Проект для согласования'));
    assert.equal(await page.locator('script,form').count(),0);
    assert(await page.locator('a[href="mailto:ekaterinakhismatulina@yandex.ru"]').count()>0);
    if(name==='legal')for(const id of ['privacy','consent','cookies','terms'])assert.equal(await page.locator('#'+id).count(),1);
    await page.screenshot({path:path.join(root,'docs/simplified/evidence/'+name+'-current-'+width+'.png'),fullPage:true});
   }
  }
  console.log('PASS 3 legal pages at 390/1280px: headings, anchors, email links, no overflow or form activation');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
