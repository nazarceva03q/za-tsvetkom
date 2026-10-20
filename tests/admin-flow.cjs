// Проверка бота управления каталогом «За цветком» (bot/src/products.js,
// bot/src/admin.js) — тем же способом, что и в проекте aura-tsvetov:
// реальные модули через vm.runInNewContext с явно подставленными
// зависимостями (без сети, без настоящего Object Storage).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function load(file, dependencies) {
  const sandbox = {
    module: { exports: {} }, __dirname: path.dirname(path.join(root, file)),
    require(name) { if (name === './price') return require('../bot/src/price'); if (name === 'crypto') return require('node:crypto'); if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name); return dependencies[name]; },
    console: { log() {}, warn() {}, error(...args) { throw Error(args.join(' ')); } },
    Buffer, setTimeout, clearTimeout, Intl, URL
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}

const config = { ownerOrdersUrl:'https://xn----ctbjb9aqim7a5cq.online/owner/orders.php', s3Public: { bucket: 'pub-test', accessKey: 'k', secretKey: 's' } };

function makeObjectStorage() {
  const names=['Букет дня','Розы','Сборные букеты','Монобукеты','Композиции','Свадебные букеты','Букеты из шаров','Для девушек','14 февраля','Девичник','Новый год','Последний звонок','Для девочек','Для мальчиков','Гендер пати','Коробка с шарами','Годовасия','Для мужчин','Для бизнеса'];
  const jsonObjects = {'catalog.json':Object.fromEntries(names.map(n=>[n,[]]))};
  let version=1;
  const binaryObjects = {};
  return {
    store: { jsonObjects, binaryObjects },
    api: {
      uploadPhoto: async (buffer,contentType)=>{const key=String(Object.keys(binaryObjects).length);binaryObjects[key]={buffer,contentType};return 'https://shop.test/assets/catalog/'+key+'.jpg';},
      getJson: async (cfg, key, fallback) => (key in jsonObjects ? JSON.parse(JSON.stringify(jsonObjects[key])) : fallback),
      putJson: async (cfg, key, data) => { jsonObjects[key] = JSON.parse(JSON.stringify(data)); return true; },
      getJsonWithVersion: async (cfg,key,fallback)=>({data:key in jsonObjects?JSON.parse(JSON.stringify(jsonObjects[key])):fallback,etag:key in jsonObjects?'"'+version+'"':null}),
      putJsonIfVersion: async(cfg,key,data,etag)=>{if(etag!=='"'+version+'"')throw Error('Concurrent update');jsonObjects[key]=JSON.parse(JSON.stringify(data));version++;return true;},
      putObject: async (cfg, key, buffer, contentType) => { binaryObjects[key] = { buffer, contentType }; return true; },
      publicUrl: (cfg, key) => 'https://storage.yandexcloud.net/' + cfg.bucket + '/' + key
    }
  };
}

function loadProducts(objectStorageApi) {
  return load('bot/src/products.js', { './config': config, './catalogClient': objectStorageApi, crypto: require('node:crypto') });
}

test('search suggests existing products with reordered words, inflections and partial matches', async () => {
  const {api}=makeObjectStorage(), products=loadProducts(api);
  const fields={price:2500,stock:3,photos:[]};
  const white=await products.saveProduct('Розы',null,{...fields,name:'Букет из белых роз'});
  await products.saveProduct('Розы',null,{...fields,name:'Букет из красных роз'});
  for(const query of ['роз белых букет','белыми розами','белая роза','белых','БЕЛЫЕ РОЗЫ']) {
    const found=await products.searchByName(query);
    assert.equal(found[0].product.id,white.id,query);
  }
  assert.equal((await products.searchByName('орхидея')).length,0);
  assert.equal((await products.searchByName('розы')).length,2);
  assert.deepEqual(Array.from(await products.searchByName('белыми розами'),m=>m.product.id),[white.id]);
  assert.equal((await products.searchByName('белые орхидеи')).length,0);
  assert.equal((await products.searchByName('для из')).length,0);
});

test('free price labels survive normal and business product editing without concatenating range digits',async()=>{
 const pricing=require('../bot/src/price');const {api}=makeObjectStorage(),products=loadProducts(api);
 for(const label of ['Товар под заказ','от 1000 руб.','1000-2000 руб.','Любой текст '.repeat(1000)]){
  const parsed=pricing.parse(label);assert.equal(parsed.price,null);assert.equal(parsed.priceLabel,label.trim());
  const item=await products.saveProduct('Розы',null,{name:'Свободная цена',...parsed,stock:1,photos:[]});
  assert.equal((await products.getProductById(item.id)).priceLabel,label.trim());
  await products.updateHit(item.id,true);assert.equal((await products.getProductById(item.id)).price,null);
 }
 assert.equal(pricing.parse('1 000 ₽').price,1000);assert.equal(pricing.parse('1000,50 руб.').price,1000.5);
 const business=await products.saveProduct('Для бизнеса',null,{name:'Оформление',photos:['/photo.jpg'],photoPrices:[null],photoPriceLabels:['от 1000 ₽']});
 assert.equal(business.price,null);assert.equal(business.priceLabel,'от 1000 ₽');
});

test('bot accepts arbitrary price text for a regular product and each business photo',async()=>{
 const env=makeAdminEnv(),id='999';
 for(const text of ['Товар под заказ','от 1000 руб.','1000-2000 руб.']){
  let session={step:'admin_field_price',draft:{category:'Розы',photos:[],name:'Тест'}};
  await env.admin.handleMessage({message:{body:{text}}},id,session);
  assert.equal(env.sessions[id].draft.price,null);assert.equal(env.sessions[id].draft.priceLabel,text);
  session={step:'admin_biz_price',pendingPhotoUrl:'/photo.jpg',draft:{category:'Для бизнеса',photos:[],photoPrices:[]}};
  await env.admin.handleMessage({message:{body:{text}}},id,session);
  assert.equal(env.sessions[id].draft.photoPrices[0],null);assert.equal(env.sessions[id].draft.photoPriceLabels[0],text);
 }
});

test('saveProduct builds the site schema: composition + height go into description, other text goes into note', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  const p1 = await products.saveProduct('Розы', null, { name: 'Тестовые розы', price: '2500', composition: ['5 роз', 'эвкалипт'], extraInfo: 'высота 60 см', stock: 10, photos: ['https://x/1.jpg'] });
  assert.equal(p1.description, '5 роз · эвкалипт · высота 60 см');
  assert.equal(p1.note, '');
  assert.equal(p1.price, 2500);
  assert.equal(p1.stock, 10);

  const p2 = await products.saveProduct('Розы', null, { name: 'Тест 2', price: 3000, composition: [], extraInfo: 'Бутоньерка включена', stock: null, photos: ['https://x/2.jpg'] });
  assert.equal(p2.description, '');
  assert.equal(p2.note, 'Бутоньерка включена');
  assert.equal(p2.stock, null);
});

test('saveProduct on a balloon category with dash stock sets madeToOrder and the fixed under-order note', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  const p = await products.saveProduct('Букеты из шаров', null, { name: 'Тестовый букет шаров', price: 2500, composition: [], extraInfo: '', stock: null, photos: ['https://x/1.png'] });
  assert.equal(p.madeToOrder, true);
  assert.match(p.note, /Товар под заказ/);
});

test('saveProduct on a business category computes price/maxPrice from per-photo prices', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  const p = await products.saveProduct('Для бизнеса', null, {
    name: 'Тестовое оформление', photos: ['https://x/1.jpg', 'https://x/2.jpg'], photoPrices: [8500, 12000], isHit: false
  });
  assert.equal(p.business, true);
  assert.equal(p.price, 8500);
  assert.equal(p.maxPrice, 12000);
  assert.equal(p.note, products.BUSINESS_NOTE);
});

test('a hit is unshifted to the very top of its category, ahead of existing items', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  await products.saveProduct('Розы', null, { name: 'Обычная роза 1', price: 1000, composition: [], extraInfo: '', stock: 5, photos: ['https://x/1.jpg'] });
  await products.saveProduct('Розы', null, { name: 'Обычная роза 2', price: 1200, composition: [], extraInfo: '', stock: 5, photos: ['https://x/2.jpg'] });
  const hit = await products.saveProduct('Розы', null, { name: 'Хитовая роза', price: 900, composition: [], extraInfo: '', stock: 5, photos: ['https://x/3.jpg'], isHit: true });

  const catalog = await products.getCatalog();
  assert.equal(catalog['Розы'][0].id, hit.id);
  assert.equal(catalog['Розы'].length, 3);
});

test('updateStock toggles madeToOrder/note back and forth for balloon categories', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  const created = await products.saveProduct('Букеты из шаров', null, { name: 'Шары тест', price: 2500, composition: [], extraInfo: '', stock: 5, photos: ['https://x/1.png'] });
  assert.equal(created.madeToOrder, false);

  await products.updateStock(created.id, null);
  let found = await products.getProductById(created.id);
  assert.equal(found.madeToOrder, true);
  assert.match(found.note, /Товар под заказ/);

  await products.updateStock(created.id, 7);
  found = await products.getProductById(created.id);
  assert.equal(found.madeToOrder, false);
  assert.equal(found.stock, 7);
  assert.equal(found.note, '');
});

test('deleteProductById removes the product from whichever category holds it', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  const created = await products.saveProduct('Монобукеты', null, { name: 'Тест на удаление', price: 500, composition: [], extraInfo: '', stock: 1, photos: ['https://x/1.jpg'] });
  assert.equal(await products.deleteProductById(created.id), true);
  assert.equal(await products.getProductById(created.id), null);
  assert.equal(await products.deleteProductById('not-a-real-id'), false);
});

test('searchByName finds a product by partial, case-insensitive, unpunctuated input', async () => {
  const { api } = makeObjectStorage();
  const products = loadProducts(api);
  await products.saveProduct('Розы', null, { name: 'Букет из французских роз', price: 3750, composition: [], extraInfo: '', stock: 3, photos: ['https://x/1.jpg'] });
  const results = await products.searchByName('французских');
  assert.ok(results.length >= 1);
  assert.equal(results[0].product.name, 'Букет из французских роз');
  assert.equal((await products.searchByName('совсем не тот запрос xyz')).length, 0);
});

// – Полный сценарий «Добавить товар» через bot.handleUpdate-уровень
// (admin.handleCallback/handleMessage напрямую), от кнопки меню до записи
// в catalog.json – для обычной категории и для «Для бизнеса».

function makeAdminEnv() {
  const sessions = {};
  const owner = [];
  const { api: objectStorageApi } = makeObjectStorage();
  const productsModule = load('bot/src/products.js', { './config': config, './catalogClient': objectStorageApi, crypto: require('node:crypto') });
  const downloadedUrls = [];
  const vkApiMock = {
    sendMessage: async (target, text, rows) => { owner.push({ text, rows }); return { ok: true }; },
    sendPhotoUrlMessage: async (target, text, rows, photoUrl) => { owner.push({ text, rows, photoUrl }); return { ok: true }; },
    downloadBinary: async (url) => { downloadedUrls.push(url); return { buffer: Buffer.from('bytes-for-' + url), contentType: 'image/jpeg' }; },
    callbackButton: (text, payload) => ({ type: 'callback', text, payload }),
    linkButton: (text,link)=>({type:'open_link',text,link})
  };
  const storeMock = {
    getSession: async (id) => sessions[id] || { step: 'idle' },
    setSession: async (id, value) => { sessions[id] = value; },
    clearSession: async (id) => { delete sessions[id]; },
    getLeadsPage: async () => ({ items: [], total: 0 })
  };
  const admin = load('bot/src/admin.js', { './config': config, './vkApi': vkApiMock, './store': storeMock, './products': productsModule });
  return { admin, sessions, owner, products: productsModule, downloadedUrls, vkApi:vkApiMock };
}

test('full "add product" flow for a regular category publishes with the site schema and asks the Hit question', async () => {
  const env = makeAdminEnv();
  const userId = '999';

  await env.admin.sendMenu(userId);
  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'admin:add'), true);
  assert.match(env.owner.at(-1).text, /Выберите категорию/);

  // "Розы" — второй пункт полного списка категорий (после «Букет дня»).
  const roseIndex = env.products.CATEGORY_NAMES.indexOf('Розы');
  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'add:cat:' + roseIndex), true);
  assert.equal(env.sessions[userId].draft.category, 'Розы');
  assert.match(env.owner.at(-1).text, /фото/i);
  // Фото — первый вопрос для этого сайта (не название), как в её сценарии.
  assert.equal(env.owner.at(-1).rows.length, 1);

  await env.admin.handleMessage({ message: { body: { attachments: [{ type: 'image', payload: { url: 'https://max.example/1.jpg' } }] } } }, userId, env.sessions[userId]);
  assert.equal(env.sessions[userId].draft.photos.length, 1);
  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'photos:done'), true);
  assert.match(env.owner.at(-1).text, /название/i);

  await env.admin.handleMessage({ message: { body: { text: 'Тестовый букет роз' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /состав/i);

  await env.admin.handleMessage({ message: { body: { text: '• 5 роз\n• эвкалипт' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /описание/i);

  await env.admin.handleMessage({ message: { body: { text: 'высота 50 см' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /цену/i);

  await env.admin.handleMessage({ message: { body: { text: '3200' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /количество/i);

  await env.admin.handleMessage({ message: { body: { text: '-' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /Хитом/);

  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'hit:set:1'), true);
  const preview = env.owner.at(-1);
  assert.match(preview.text, /Тестовый букет роз/);
  assert.match(preview.text, /Хит: да/);
  assert.match(preview.text, /под заказ/);

  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'preview:save'), true);
  assert.match(env.owner.at(-1).text, /опубликован на сайте/);

  const catalog = await env.products.getCatalog();
  assert.equal(catalog['Розы'].length, 1);
  const saved = catalog['Розы'][0];
  assert.equal(saved.name, 'Тестовый букет роз');
  assert.equal(saved.price, 3200);
  assert.equal(saved.description, '5 роз · эвкалипт · высота 50 см');
  assert.equal(saved.stock, null);
  assert.equal(saved.isHit, true);
});

test('full "add product" flow for "Для бизнеса" pairs each photo with its own price and computes the range', async () => {
  const env = makeAdminEnv();
  const userId = '999';

  await env.admin.sendMenu(userId);
  await env.admin.handleCallback(userId, env.sessions[userId], 'admin:add');
  const bizIndex = env.products.CATEGORY_NAMES.indexOf('Для бизнеса');
  await env.admin.handleCallback(userId, env.sessions[userId], 'add:cat:' + bizIndex);
  assert.match(env.owner.at(-1).text, /Загрузите фото/);

  await env.admin.handleMessage({ message: { body: { attachments: [{ type: 'image', payload: { url: 'https://max.example/biz1.jpg' } }] } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /Оформление на фото/);

  await env.admin.handleMessage({ message: { body: { text: '8500' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /Фото добавлено \(1/);

  await env.admin.handleMessage({ message: { body: { attachments: [{ type: 'image', payload: { url: 'https://max.example/biz2.jpg' } }] } } }, userId, env.sessions[userId]);
  await env.admin.handleMessage({ message: { body: { text: '12000' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /Фото добавлено \(2/);

  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'biz:photo:done'), true);
  assert.match(env.owner.at(-1).text, /название/i);

  await env.admin.handleMessage({ message: { body: { text: 'Оформление тестового зала' } } }, userId, env.sessions[userId]);
  assert.match(env.owner.at(-1).text, /Метраж рассчитывается/);

  assert.equal(await env.admin.handleCallback(userId, env.sessions[userId], 'biz:note:keep'), true);
  assert.match(env.owner.at(-1).text, /Хитом/);

  await env.admin.handleCallback(userId, env.sessions[userId], 'hit:set:0');
  const preview = env.owner.at(-1);
  // Intl.NumberFormat('ru-RU') использует неразрывный пробел, а не обычный —
  // сверяем просто наличие обоих чисел, точную детальную проверку диапазона
  // делаем ниже через сами сохранённые числа (saved.price/maxPrice).
  assert.match(preview.text, /8.500/);
  assert.match(preview.text, /12.000/);

  await env.admin.handleCallback(userId, env.sessions[userId], 'preview:save');
  const catalog = await env.products.getCatalog();
  assert.equal(catalog['Для бизнеса'].length, 1);
  const saved = catalog['Для бизнеса'][0];
  assert.equal(saved.price, 8500);
  assert.equal(saved.maxPrice, 12000);
  assert.deepEqual(Array.from(saved.photoPrices), [8500, 12000]);
  assert.equal(saved.note, env.products.BUSINESS_NOTE);
});

test('removing Hit status from an existing product asks for confirmation, marking does not', async () => {
  const env = makeAdminEnv();
  const userId = '999';
  const created = await env.products.saveProduct('Композиции', null, { name: 'Композиция для теста', price: 1500, composition: [], extraInfo: '', stock: 2, photos: ['https://x/1.jpg'], isHit: true });

  await env.admin.sendMenu(userId);
  await env.admin.handleCallback(userId, env.sessions[userId], 'admin:edit');
  await env.admin.handleMessage({ message: { body: { text: 'композиция для теста' } } }, userId, env.sessions[userId]);
  await env.admin.handleCallback(userId, env.sessions[userId], 'find:pick:0');
  assert.equal(env.sessions[userId].draft.isHit, true);

  await env.admin.handleCallback(userId, env.sessions[userId], 'edit:field:isHit');
  assert.match(env.owner.at(-1).text, /Убрать товар из Хитов/);

  await env.admin.handleCallback(userId, env.sessions[userId], 'hit:set:0');
  assert.match(env.owner.at(-1).text, /Хит: нет/);
  await env.admin.handleCallback(userId, env.sessions[userId], 'preview:save');

  const updated = await env.products.getProductById(created.id);
  assert.equal(updated.isHit, false);
});

test('stale buttons from a finished flow prompt to restart instead of crashing', async () => {
  const env = makeAdminEnv();
  const userId = '999';
  // 'add:cat:N' не входит в этот список: без черновика оно просто начинает
  // новое добавление в выбранной категории (см. pickCategory) — это не
  // ошибка, а нормальный способ стартовать сценарий заново с этой кнопки.
  await env.admin.sendMenu(userId);
  for (const staleData of ['edit:field:name', 'photos:done', 'biz:photo:done', 'preview:save']) {
    env.owner.length = 0;
    const handled = await env.admin.handleCallback(userId, env.sessions[userId], staleData);
    assert.equal(handled, true, staleData);
    assert.match(env.owner.at(-1).text, /устарела/, staleData);
  }
});

test('Hit menu marks and unmarks existing products, keeps all hits first and rejects stale buttons', async () => {
 const env=makeAdminEnv(), id='999';
 const fields={price:1000,composition:[],extraInfo:'',stock:2,photos:['https://x/1.jpg']};
 const ordinary=await env.products.saveProduct('Розы',null,{...fields,name:'Роза обычная'});
 const hit=await env.products.saveProduct('Розы',null,{...fields,name:'Роза хит',isHit:true});
 await env.admin.sendMenu(id);
 assert.ok(env.owner.at(-1).rows.flat().some(b=>b.payload==='admin:hit'));
 await env.admin.handleCallback(id,env.sessions[id],'admin:hit');
 await env.admin.handleMessage({message:{body:{text:'Роза обычная'}}},id,env.sessions[id]);
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:0');
 await env.admin.handleCallback(id,env.sessions[id],'existing:hit:1');
 assert.equal((await env.products.getProductById(ordinary.id)).isHit,true);
 await env.products.saveProduct('Розы',null,{...fields,name:'Новая обычная роза'});
 assert.deepEqual(Array.from((await env.products.getCatalog())['Розы'],p=>p.isHit),[true,true,false]);
 await env.products.updateHit(hit.id,false);
 assert.deepEqual(Array.from((await env.products.getCatalog())['Розы'],p=>p.isHit),[true,false,false]);
 await env.admin.handleCallback(id,env.sessions[id],'existing:hit:0');
 assert.match(env.owner.at(-1).text,/устарела/);
 assert.equal((await env.products.getProductById(ordinary.id)).isHit,true);
});

test('failed catalog write does not report a successful hit update', async () => {
 const {api}=makeObjectStorage();const products=loadProducts(api);
 const p=await products.saveProduct('Розы',null,{name:'Роза',price:1000,stock:2,photos:[]});
 api.putJsonIfVersion=async()=>false;
 await assert.rejects(products.updateHit(p.id,true),/REG.RU/);
});

test('requests button sends a working protected-panel link',async()=>{
 const env=makeAdminEnv();await env.admin.sendMenu('999');
 await env.admin.handleCallback('999',env.sessions['999'],'admin:leads');
 const message=env.owner.at(-1);assert.match(message.text,/закрытой панели/);
 assert.equal(message.rows[0][0].type,'open_link');assert.equal(message.rows[0][0].link,config.ownerOrdersUrl);
});
test('stock prompt, exact validation, zero stock and deleted item handling',async()=>{
 const env=makeAdminEnv(),id='999';
 const p=await env.products.saveProduct('Розы',null,{name:'Тест количества',price:1000,stock:4,photos:[]});
 await env.admin.sendMenu(id);await env.admin.handleCallback(id,env.sessions[id],'admin:stock');
 assert.equal(env.owner.at(-1).text,'Напишите название товара, чтобы изменить его количество.');
 await env.admin.handleMessage({message:{body:{text:'Тест количества'}}},id,env.sessions[id]);
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:0');
 for(const value of ['-2','1.5','три','10001']){
  await env.admin.handleMessage({message:{body:{text:value}}},id,env.sessions[id]);
  assert.equal((await env.products.getProductById(p.id)).stock,4);
 }
 await env.admin.handleMessage({message:{body:{text:'0'}}},id,env.sessions[id]);
 assert.equal((await env.products.getProductById(p.id)).stock,0);assert.match(env.owner.at(-1).text,/сохранено в каталоге/);
 await assert.rejects(env.products.updateStock(p.id,-1),/Invalid stock/);
});
test('stock selection asks once: repeated click/search and empty event do not produce a second number request',async()=>{
 const env=makeAdminEnv(),id='999';
 const product=await env.products.saveProduct('Розы',null,{name:'Белые розы',price:1000,stock:4,photos:[]});
 await env.admin.sendMenu(id);await env.admin.handleCallback(id,env.sessions[id],'admin:stock');
 const search={message:{body:{mid:'search-1',text:'белые розы'}}};
 await env.admin.handleMessage(search,id,env.sessions[id]);
 const before=env.owner.length;
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:0');
 assert.equal(env.owner.length,before+1);assert.match(env.owner.at(-1).text,/Напишите новое количество/);
 const prompted=env.owner.length;
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:0');
 for(const message of [search,{message:{body:{mid:'search-retry',text:'белые розы'}}},{message:{body:{text:'Этот товар'}}},{message:{body:{text:''}}}])
  await env.admin.handleMessage(message,id,env.sessions[id]);
 assert.equal(env.owner.length,prompted);
 assert.equal((await env.products.getProductById(product.id)).stock,4);
 await env.admin.handleMessage({message:{body:{mid:'quantity-2',text:'2'}}},id,env.sessions[id]);
 assert.equal((await env.products.getProductById(product.id)).stock,2);
 assert.equal(env.owner.length,prompted+1);
 assert.equal(env.owner.some(m=>m.text.includes('Не вижу числа')),false);
});
test('search shows one photo card at a time, navigation keeps the right product and stale buttons are ignored',async()=>{
 const env=makeAdminEnv(),id='999';
 const white=await env.products.saveProduct('Розы',null,{name:'Белые розы',price:null,priceLabel:'от 1000 ₽',stock:4,photos:['https://x/photo.jpg']});
 const red=await env.products.saveProduct('Розы',null,{name:'Красные розы',price:1000,stock:4,photos:[]});
 await env.admin.sendMenu(id);await env.admin.handleCallback(id,env.sessions[id],'admin:stock');
 const before=env.owner.length;
 await env.admin.handleMessage({message:{body:{text:'розы'}}},id,env.sessions[id]);
 assert.equal(env.owner.length,before+1);assert.match(env.owner.at(-1).text,/Белые розы/);assert.match(env.owner.at(-1).text,/от 1000 ₽/);
 assert.equal(env.owner.at(-1).photoUrl,'https://x/photo.jpg');assert.match(env.owner.at(-1).text,/Категория: Розы/);
 assert.ok(env.owner.at(-1).rows.flat().some(b=>b.payload==='find:show:1:'+red.id));
 await env.admin.handleCallback(id,env.sessions[id],'find:show:1:'+red.id);
 assert.match(env.owner.at(-1).text,/Красные розы/);assert.equal(env.owner.at(-1).photoUrl,undefined);
 const shown=env.owner.length;await env.admin.handleCallback(id,env.sessions[id],'find:show:0:wrong-id');assert.equal(env.owner.length,shown);
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:1:'+red.id);
 assert.equal(env.sessions[id].stockTarget.id,red.id);
 const prompted=env.owner.length;
 await env.admin.handleCallback(id,env.sessions[id],'find:show:0:'+white.id);
 await env.admin.handleMessage({message:{body:{text:'Этот товар'}}},id,env.sessions[id]);
 assert.equal(env.owner.length,prompted);
});
test('unavailable photo falls back to one selectable text card',async()=>{
 const env=makeAdminEnv(),id='999';
 await env.products.saveProduct('Розы',null,{name:'Роза',price:1000,stock:1,photos:['https://x/missing.jpg']});
 env.vkApi.sendPhotoUrlMessage=async()=>({ok:false});
 await env.admin.sendMenu(id);await env.admin.handleCallback(id,env.sessions[id],'admin:edit');
 const before=env.owner.length;
 await env.admin.handleMessage({message:{body:{text:'Роза'}}},id,env.sessions[id]);
 assert.equal(env.owner.length,before+1);assert.match(env.owner.at(-1).text,/Роза/);
 assert.ok(env.owner.at(-1).rows.flat().some(b=>b.payload.startsWith('find:pick:0:')));
});
test('stock save exposes only safe HTTP diagnostics and does not claim it was saved',async()=>{
 const env=makeAdminEnv(),id='999';
 await env.products.saveProduct('Розы',null,{name:'Белые розы',price:1000,stock:4,photos:[]});
 await env.admin.sendMenu(id);await env.admin.handleCallback(id,env.sessions[id],'admin:stock');
 await env.admin.handleMessage({message:{body:{text:'Белые розы'}}},id,env.sessions[id]);
 await env.admin.handleCallback(id,env.sessions[id],'find:pick:0');
 env.products.updateStock=async()=>{throw Object.assign(Error('sensitive internal detail'),{status:403});};
 await env.admin.handleMessage({message:{body:{text:'2'}}},id,env.sessions[id]);
 assert.match(env.owner.at(-1).text,/HTTP 403/);assert.ok(!env.owner.at(-1).text.includes('sensitive'));
 const before=env.owner.length;
 await env.admin.handleMessage({message:{body:{text:'Выберите товар'}}},id,env.sessions[id]);assert.equal(env.owner.length,before);
});
test('malformed or missing catalog cannot be replaced with an empty catalog',async()=>{
 const {api,store}=makeObjectStorage();const products=loadProducts(api);delete store.jsonObjects['catalog.json'];
 await assert.rejects(products.updateStock('missing',2),/Каталог отсутствует/);
 assert.equal(store.jsonObjects['catalog.json'],undefined);
 store.jsonObjects['catalog.json']={'Розы':[]};await assert.rejects(products.getCatalog(),/Каталог отсутствует/);
});
test('concurrent edits cannot silently overwrite another administrator',async()=>{
 const {api}=makeObjectStorage();const products=loadProducts(api);
 const p=await products.saveProduct('Розы',null,{name:'Роза',price:1000,stock:4,photos:[]});
 const result=await Promise.allSettled([products.updateStock(p.id,2),products.updateHit(p.id,true)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(result.filter(r=>r.status==='rejected').length,1);
});
