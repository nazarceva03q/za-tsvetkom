'use strict';
// Existing Playwright only. No installation and no external network.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
let playwright;
for(const location of [process.env.ZT_PLAYWRIGHT_MODULE,'C:/Users/User/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright'].filter(Boolean)){
 try{playwright=require(location);break}catch{}
}
if(!playwright)throw Error('Existing Playwright not found; do not install automatically');
const root=path.resolve(__dirname,'..'),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!target.startsWith(root+path.sep)||!types[path.extname(target)]){res.writeHead(404);res.end();return}
 fs.readFile(target,(error,body)=>{res.writeHead(error?404:200,{'Content-Type':types[path.extname(target)]});res.end(error?'':body)});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await playwright.chromium.launch({executablePath:process.env.ZT_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[],calls=[];let mode='failure';
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/api/v1/orders.php'){
    calls.push({key:request.headers()['idempotency-key'],body:request.postDataJSON()});
    if(mode==='failure')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'TEMPORARILY_UNAVAILABLE',message:'Сохранение не подтверждено. Корзина сохранена.'})});
    if(mode==='network')return route.abort();
    if(mode==='server500')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,code:'INTERNAL_ERROR',message:'Сохранение не подтверждено.'})});
    if(mode==='invalid')return route.fulfill({status:200,contentType:'text/html',body:'broken'});
    await new Promise(resolve=>setTimeout(resolve,40));
    return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,saved:true,orderNumber:'ZT-0123456789ABCDEF',replayed:calls.length>1})});
   }
   if(['image','font'].includes(request.resourceType()))return route.abort();
   return route.continue();
  });
  await page.goto(origin);await page.waitForFunction(()=>Boolean(window.ZTCheckout));
  assert.equal(await page.evaluate(()=>allProducts.length),54);
  assert.equal(await page.evaluate(()=>allProducts.find(p=>p.id==='product-french-eucalyptus').stock),null);
  await page.evaluate(()=>{add('product-french-eucalyptus');add('balloon-bouquet-violet-wishes')});
  await page.locator('#cartButton').click();
  await page.locator('[data-form="Заявка на заказ"]').first().click();
  await page.locator('#requestForm [name="name"]').fill('Локальная проверка');
  await page.locator('#requestForm [name="phone"]').fill('79990000000');
  await page.locator('#requestForm [name="date"]').fill(await page.evaluate(()=>permDate(new Date(Date.now()+86400000))));
  await page.locator('#requestForm [name="channel"]').selectOption('Телефон');
  await page.locator('#deliverySelect').selectOption('Доставка');
  await page.locator('#requestForm [name="time"]').selectOption('16-19');
  await page.locator('#requestForm [name="address"]').fill('Тестовый адрес, не доставлять');
  await page.locator('#requestForm [name="comment"]').fill('Только локальная проверка');
  await page.locator('#requestForm [name="consent"]').check();
  const fieldsBefore=await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('#requestForm'))));
  await page.locator('#requestForm button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-submit-error]')?.textContent.includes('не подтверждено'));
  assert.equal(calls.length,1);
  assert.deepEqual(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('#requestForm')))),fieldsBefore);
  assert.equal(await page.locator('#requestForm [name="address"]').isDisabled(),false);
  assert.equal(await page.locator('#requestForm [name="name"]').inputValue(),'Локальная проверка');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('zt:cart'))),{'product-french-eucalyptus':1,'balloon-bouquet-violet-wishes':1});
  assert.ok(!await page.locator('#modalBody').textContent().then(x=>x.includes('Заявка сохранена')));
  mode='success';
  await page.evaluate(()=>{document.querySelector('#requestForm').requestSubmit();document.querySelector('#requestForm').requestSubmit()});
  await page.waitForSelector('#savedOrderNumber');
  assert.equal(calls.length,2);assert.equal(calls[0].key,calls[1].key);
  assert.equal(calls[1].body.kind,'order');assert.equal(calls[1].body.items.length,2);
  assert.ok(calls[1].body.items.some(x=>x.id==='balloon-bouquet-violet-wishes'&&typeof x.name==='string'&&!('expectedPriceKopecks' in x)));
  assert.deepEqual(await page.evaluate(()=>cart),{});
  await page.locator('#modal .close').click();
  await page.evaluate(()=>{add('product-french-eucalyptus');form('Букет из шаров: консультация')});
  await page.locator('#requestForm [name="name"]').fill('Локальная консультация');
  await page.locator('#requestForm [name="phone"]').fill('79990000001');
  await page.locator('#requestForm [name="consent"]').check();
  await page.locator('#requestForm button[type="submit"]').click();await page.waitForSelector('#savedOrderNumber');
  assert.equal(calls[2].body.kind,'inquiry');assert.deepEqual(calls[2].body.items,[]);
  assert.deepEqual(await page.evaluate(()=>cart),{'product-french-eucalyptus':1});
  await page.locator('#modal .close').click();
  mode='invalid';
  await page.evaluate(()=>form('Заявка на заказ'));
  await page.locator('#requestForm [name="name"]').fill('Ошибка ответа');
  await page.locator('#requestForm [name="phone"]').fill('79990000002');
  await page.locator('#requestForm [name="consent"]').check();
  await page.locator('#requestForm button[type="submit"]').click();
  await page.waitForSelector('[data-submit-error]');
  assert.deepEqual(await page.evaluate(()=>cart),{'product-french-eucalyptus':1});
  assert.equal(await page.locator('#savedOrderNumber').count(),0);
  for(const failure of ['server500','network']){
   mode=failure;
   await page.evaluate(()=>{localStorage.removeItem('zt:checkout-pending-v1');form('Заявка на заказ')});
   await page.locator('#requestForm [name="name"]').fill('Ошибка сервера');
   await page.locator('#requestForm [name="phone"]').fill('79990000003');
   await page.locator('#deliverySelect').selectOption('Доставка');
   await page.locator('#requestForm [name="address"]').fill('Тестовый адрес, без доставки');
   await page.locator('#requestForm [name="comment"]').fill('Не терять это поле');
   await page.locator('#requestForm [name="consent"]').check();
   const before=await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('#requestForm'))));
   await page.locator('#requestForm button[type="submit"]').click();
   await page.waitForSelector('[data-submit-error]');
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('#requestForm')))),before);
   assert.equal(await page.locator('#savedOrderNumber').count(),0);
   assert.deepEqual(await page.evaluate(()=>cart),{'product-french-eucalyptus':1});
   assert.ok(!await page.evaluate(()=>localStorage.getItem('zt:checkout-pending-v1')).then(value=>value.includes('79990000003')));
  }
  mode='success';
  for(const subject of ['Подбор подарка','Большой букет','Корпоративные подарки','Задать вопрос','Предзаказ: праздник']){
   if(await page.locator('#modal .close').isVisible())await page.locator('#modal .close').click();
   await page.evaluate(s=>{localStorage.removeItem('zt:checkout-pending-v1');form(s)},subject);
   await page.locator('#requestForm [name="name"]').fill('Локальный тест');
   await page.locator('#requestForm [name="phone"]').fill('79990000000');
   await page.locator('#requestForm [name="comment"]').fill('Пожелания к заявке');
   if(subject.includes('Корпоратив')){await page.locator('#requestForm [name="quantity"]').fill('20');await page.locator('#requestForm [name="budget"]').fill('3000');}
   await page.locator('#requestForm [name="consent"]').check();
   await page.locator('#requestForm button[type="submit"]').click();await page.waitForSelector('#savedOrderNumber');
   assert.equal(calls.at(-1).body.kind,'inquiry');assert.deepEqual(calls.at(-1).body.items,[]);
   assert.equal(calls.at(-1).body.comment,'Пожелания к заявке');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real local forms, made-to-order balloons, HTTP failure/retry, duplicate click, inquiry, invalid response, HTTP 500, network failure, all fields retained, no page errors; all API responses mocked');
 }finally{await browser.close()}
})().then(()=>server.close()).catch(error=>{console.error(error);server.close();process.exitCode=1});
