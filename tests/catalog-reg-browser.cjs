'use strict';
// Actual storefront rendering with a local REG API fixture; all external
// requests (including Yandex) are blocked. No production writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {buildSeed}=require('../bot/scripts/catalog-seed.cjs');
let playwright;
for(const modulePath of [process.env.ZT_PLAYWRIGHT_MODULE,'C:/Users/User/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright'].filter(Boolean))try{playwright=require(modulePath);break}catch{}
if(!playwright)throw Error('Existing Playwright required; do not install automatically');
const root=path.resolve(__dirname,'..'),data=buildSeed(root),id=data['Розы'][0].id;
data['Розы'][0].stock=2;
const extra={...data['Розы'][0],id:'product-reg-local-only',slug:'reg-local-only',name:'Тестовый товар REG',stock:3,price:1234,images:['/assets/catalog/local.jpg'],isHit:true};
data['Розы'].unshift(extra);
let fail=false;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ttf':'font/ttf','.woff2':'font/woff2','.woff':'font/woff'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/v1/catalog.php'){res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(fail?{ok:false}:data));return;}
 const target=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!target.startsWith(root+path.sep)||!types[path.extname(target)]){res.writeHead(404);res.end();return;}
 fs.readFile(target,(error,body)=>{
  if(!error&&target.endsWith('index.html'))body=body.toString().replace('<meta name="catalog-url" content="">','<meta name="catalog-url" content="/api/v1/catalog.php">');
  res.writeHead(error?404:200,{'Content-Type':types[path.extname(target)]});res.end(error?'':body);
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await playwright.chromium.launch({executablePath:process.env.ZT_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[],cloud=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const r=route.request(),url=new URL(r.url());if(url.origin!==origin){if(/yandexcloud/.test(url.host))cloud.push(url.href);return route.abort();}if(url.pathname==='/assets/catalog/local.jpg')return route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(path.join(root,data['Розы'][1].images[0].split('?')[0]))});if(r.resourceType()==='image')return route.abort();return route.continue();});
  await page.addInitScript(()=>localStorage.setItem('zt:cart',JSON.stringify({'product-reg-local-only':2})));
  await page.goto(origin);await page.waitForFunction(()=>window.ZTCatalogState?.connected);
  await page.evaluate(()=>{bonusShown=true;if(modalMode==='bonus')modal.close()});
  assert.equal(await page.evaluate(()=>allProducts.length),54); // 53 real + added, no placeholder
  assert.equal(await page.evaluate(()=>cart['product-reg-local-only']),2); // kept while loading
  assert.equal(await page.evaluate(id=>allProducts.find(p=>p.id===id).stock,id),2);
  await page.evaluate(id=>{for(let i=0;i<5;i++)add(id)},id);
  assert.equal(await page.evaluate(id=>cart[id],id),2);
  assert.ok(await page.locator('[data-add="product-reg-local-only"]').count());
  const frame=page.locator('#products [data-photo-product="product-reg-local-only"]');
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('#cookieAccept').click();
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});
   await frame.scrollIntoViewIfNeeded();
   assert.equal(await frame.locator('.hit-badge').textContent(),'Хит');
   const badge=await frame.locator('.hit-badge').boundingBox(),photo=await frame.boundingBox(),heart=await frame.locator('.heart').boundingBox();
   assert.ok(badge.x>=photo.x&&badge.y>=photo.y&&badge.x+badge.width<=heart.x,'hit badge stays top-left and clear of favorite');
   assert.ok(badge.y-photo.y<20);
   fs.mkdirSync(path.join(root,'preview'),{recursive:true});
   await frame.screenshot({path:path.join(root,'preview/hit-'+width+'.png')});
  }
  extra.isHit=false;await page.evaluate(()=>loadDynamicCatalog());
  assert.equal(await frame.locator('.hit-badge').count(),0);
  data['Розы'].find(p=>p.id===id).stock=1;extra.name='Новое название REG';extra.price=1500;
  assert.equal(await page.evaluate(()=>loadDynamicCatalog()),true);
  assert.equal(await page.evaluate(id=>cart[id],id),1);
  assert.equal(await page.evaluate(()=>allProducts.find(p=>p.id==='product-reg-local-only').name),'Новое название REG');
  assert.equal(await page.evaluate(()=>allProducts.find(p=>p.id==='product-reg-local-only').price),1500);
  data['Розы']=data['Розы'].filter(p=>p.id!=='product-reg-local-only');await page.evaluate(()=>loadDynamicCatalog());
  assert.equal(await page.evaluate(()=>allProducts.some(p=>p.id==='product-reg-local-only')),false);
  assert.equal(await page.evaluate(()=>cart['product-reg-local-only']),undefined);
  // Reproduce a new business card beside balloons with different text lengths.
  const balloonTemplate=Object.values(data).flat().find(p=>p.category==='Букеты из шаров');
  data['Букеты из шаров'].unshift({...balloonTemplate,id:'layout-balloon',name:'Короткое название',images:['/assets/catalog/local.jpg'],isHit:true});
  data['Для бизнеса'].unshift({id:'layout-business',slug:'layout-business',name:'Тест оформления с более длинным названием',category:'Для бизнеса',business:true,
   images:['/assets/catalog/local.jpg'],price:null,maxPrice:null,priceLabel:'от 1000 ₽\nСтоимость уточняется',photoPrices:[null],photoPriceLabels:['от 1000 ₽'],description:'Тест',note:'Тест',stock:null,isHit:true});
  data['Для девушек'].unshift({...balloonTemplate,id:'layout-custom-price',category:'Для девушек',name:'Текстовая цена',price:null,priceLabel:'<Товар под заказ> & от 1000 ₽',images:['/assets/catalog/local.jpg'],isHit:true});
  await page.evaluate(()=>{balloonExpanded=true;return loadDynamicCatalog()});
  for(const width of [360,768,1440]){
   await page.setViewportSize({width,height:1100});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const geometry=await page.locator('#balloonProducts>.compact-card').evaluateAll(cards=>cards.map(card=>({top:Math.round(card.getBoundingClientRect().top),photo:card.querySelector('.live-photo').getBoundingClientRect().height,
    cells:[...card.querySelector('.product-info').children].map(el=>el.getBoundingClientRect().top)})));
   for(const card of geometry){const row=geometry.filter(other=>other.top===card.top);for(const other of row){assert.ok(Math.abs(card.photo-other.photo)<2);for(let i=0;i<5;i++)assert.ok(Math.abs(card.cells[i]-other.cells[i])<2,'all card types align including action buttons');}}
   await page.evaluate(()=>window.scrollTo(0,document.querySelector('#balloonProducts').getBoundingClientRect().top+scrollY-30));
   await page.screenshot({path:path.join(root,'preview/aligned-cards-'+width+'.png')});
  }
  const variable=page.locator('[data-info-product="layout-custom-price"]');
  assert.equal(await variable.locator('.product-price').textContent(),'<Товар под заказ> & от 1000 ₽');
  assert.equal(await variable.locator('.product-actions button').textContent(),'Уточнить цену');
  await variable.locator('.product-actions button').click();assert.ok(await page.locator('#requestForm').count());
  assert.equal(await page.evaluate(()=>cart['layout-custom-price']),undefined);
  await page.locator('#modal .close').click();
  for(const category of Object.keys(data))data[category]=data[category].filter(p=>!p.id.startsWith('layout-'));
  await page.evaluate(()=>loadDynamicCatalog());
  fail=true;assert.equal(await page.evaluate(()=>loadDynamicCatalog()),false);
  assert.equal(await page.evaluate(()=>window.ZTCatalogState.mode),'fallback');
  assert.equal(await page.evaluate(()=>allProducts.length),53);
  assert.ok(await page.locator('#catalogConnectionNotice').isVisible());
  assert.deepEqual(cloud,[]);assert.deepEqual(errors,[]);
  console.log('PASS storefront: REG catalogue, cart/stock cap, renamed/repriced/deleted product, retained products on REG failure; zero Yandex requests.');
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
