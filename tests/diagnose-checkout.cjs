const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('C:/Users/User/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.join(root,name==='/'?'index.html':name);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');fs.createReadStream(file).pipe(res);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let sent=0;
await page.route('**/api/v1/orders.php',r=>{sent++;return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,saved:true,orderNumber:'ZT-1111111111111111',replayed:false})});});
await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(1500);
await page.evaluate(()=>{const p=allProducts.find(x=>!x.placeholder&&!x.business&&x.stock!==0);cart={[p.id]:1};form('Заявка на заказ');});
const f=page.locator('#requestForm');await f.locator('[name=name]').fill('Вымышленный клиент');await f.locator('[name=phone]').fill('+7 (000) 000-00-00');await f.locator('[name=comment]').fill('Техническая проверка без реального покупателя');await f.locator('[name=consent]').check();
console.log('BEFORE',await f.evaluate(f=>({valid:f.checkValidity(),invalid:[...f.elements].filter(x=>x.validity&&!x.validity.valid).map(x=>({name:x.name,value:x.value,message:x.validationMessage,pattern:x.pattern})),button:f.querySelector('[type=submit]').disabled})));
await f.locator('[type=submit]').click();await page.waitForTimeout(800);console.log(JSON.stringify({sent,errors,body:(await page.locator('#modalBody').innerText()).slice(-1300)}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
