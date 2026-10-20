// Run with a PHP-WASM instance supplied by the isolated local lab. No services
// or credentials required. Exercises the actual public PHP gateway and storage.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
export async function runCatalogReview(php,root) {
 const {buildSeed}=require(path.join(root,'bot/scripts/catalog-seed.cjs'));
 const seed=buildSeed(root), origin='https://shop.test', secret='a'.repeat(64);
 for(const dir of ['/private/lib','/private/bin','/private/catalog','/public/api/v1','/public/assets/catalog'])php.mkdirTree(dir);
 for(const [local,target] of [['backend/orders/lib/Catalog.php','/private/lib/Catalog.php'],['backend/orders/bin/init-catalog.php','/private/bin/init-catalog.php'],['api/v1/catalog.php','/public/api/v1/catalog.php']]) {
  const bytes=fs.readFileSync(path.join(root,local));php.writeFile(target,bytes);
  const lint=await php.run({code:'<?php token_get_all(base64_decode("'+bytes.toString('base64')+'"),TOKEN_PARSE);'});
  assert.equal(lint.errors,'',local);assert.equal(lint.exitCode,0,local);
 }
 for(const p of Object.values(seed).flat())for(const image of p.images){const file=image.split('?')[0];assert.ok(fs.existsSync(path.join(root,file)),image);php.mkdirTree(path.posix.dirname('/public/'+file));php.writeFile('/public/'+file,'fixture');}
 const config={origin,catalog:{enabled:true,secret}};
 const saveConfig=()=>php.writeFile('/private/config.php','<?php return json_decode(base64_decode("'+Buffer.from(JSON.stringify(config)).toString('base64')+'"),true);');saveConfig();
 const setup=await php.run({code:'<?php require "/private/lib/Catalog.php"; $c=json_decode(base64_decode("'+Buffer.from(JSON.stringify(seed)).toString('base64')+'"),true); \\ZTCatalog\\validate($c,"/public","'+origin+'"); \\ZTCatalog\\writeState("/private/catalog",["catalog"=>$c,"etag"=>\\ZTCatalog\\revision($c),"receipts"=>[]]);'});
 assert.equal(setup.errors,'');assert.equal(setup.exitCode,0,setup.text);
 async function request(method,body='',headers={},query='') {
  const raw=Buffer.isBuffer(body)?body:typeof body==='string'?body:JSON.stringify(body);
  const server={DOCUMENT_ROOT:'/public',HTTPS:'on',CONTENT_LENGTH:String(Buffer.byteLength(raw)),CONTENT_TYPE:headers['Content-Type']||'application/json'};
  for(const [key,value]of Object.entries(headers))if(key!=='Content-Type')server['HTTP_'+key.toUpperCase().replaceAll('-','_')]=value;
  const r=await php.run({scriptPath:'/public/api/v1/catalog.php',relativeUri:'/api/v1/catalog.php'+query,method,body:Buffer.from(raw),headers,$_SERVER:server,env:{ZT_ORDERS_PRIVATE_DIR:'/private'}});
  assert.equal(r.errors,'',r.text);return {status:r.httpStatusCode,data:JSON.parse(r.text),headers:r.headers};
 }
 let first=await request('GET');assert.equal(first.status,200);assert.equal(Object.values(first.data).flat().length,53);
 const revision=()=>JSON.parse(php.readFileAsText('/private/catalog/state.json')).etag;
 const version=revision(), auth={Authorization:'Bearer '+secret,'If-Match':version,'Idempotency-Key':'1'.repeat(64)};
 let changed=structuredClone(seed);changed['Розы'][0].stock=7;
 assert.equal((await request('PUT',changed)).status,403);
 assert.equal((await request('PUT',changed,{...auth,Authorization:'Bearer wrong'})).status,403);
 assert.equal(revision(),version);
 assert.equal((await request('PUT',changed,auth)).status,200);
 assert.equal((await request('GET')).data['Розы'][0].stock,7);
 assert.equal((await request('PUT',changed,auth)).data.replayed,true);
 const fastCgiAuth={...auth,'X-ZT-Catalog-Key':secret};delete fastCgiAuth.Authorization;
 assert.equal((await request('PUT',changed,fastCgiAuth)).data.replayed,true);
 assert.equal((await request('PUT',changed,{...fastCgiAuth,'X-ZT-Catalog-Key':'incorrect'})).status,403);
 changed['Розы'][0].stock=2;
 assert.equal((await request('PUT',changed,auth)).status,409);
 assert.equal((await request('PUT',changed,{...auth,'Idempotency-Key':'2'.repeat(64)})).status,409);
 let current=revision();
 const put=body=>request('PUT',body,{...auth,'If-Match':current,'Idempotency-Key':'3'.repeat(64)});
 const invalid=structuredClone(changed);invalid['Розы'][0].images=['https://storage.yandexcloud.net/public/photo.jpg'];assert.equal((await put(invalid)).status,422);
 invalid['Розы'][0].images=['assets/catalog/missing.jpg'];assert.equal((await put(invalid)).status,422);
 invalid['Розы'][0].images=['../private/config.php'];assert.equal((await put(invalid)).status,422);
 invalid['Розы'][0].images=seed['Розы'][0].images;invalid['Розы'][0].stock=-1;assert.equal((await put(invalid)).status,422);
 assert.equal(revision(),current);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=','base64');
 const photoHeaders={Authorization:'Bearer '+secret,'Content-Type':'image/png'};
 const photo=await request('POST',png,photoHeaders,'?action=photo');assert.equal(photo.status,200);assert.match(photo.data.url,/^https:\/\/shop.test\/assets\/catalog\/[a-f0-9]{64}\.png$/);
 assert.equal((await request('POST',png,photoHeaders,'?action=photo')).data.url,photo.data.url);
 assert.equal((await request('POST','<?php echo 1;',photoHeaders,'?action=photo')).status,422);
 changed['Розы'][0].images=[photo.data.url];assert.equal((await put(changed)).status,200);
 assert.equal((await request('GET')).data['Розы'][0].images[0],photo.data.url);
 // Bot -> real client -> real PHP gateway -> subsequent storefront GET.
 const botConfig={regCatalogUrl:origin+'/api/v1/catalog.php',regCatalogSecret:secret};
 function load(file,deps,extra={}) {
  const context={module:{exports:{}},require:name=>name in deps?deps[name]:require(name),Buffer,URL,AbortSignal,console,...extra};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});return context.module.exports;
 }
 const client=load('bot/src/catalogClient.js',{'./config':botConfig},{fetch:async(url,options)=>{
  assert.equal(new URL(url).origin,origin);
  const response=await request(options.method,options.body||'',options.headers,new URL(url).search);
  return new Response(JSON.stringify(response.data),{status:response.status,headers:{etag:revision()}});
 }});
 const products=load('bot/src/products.js',{'./config':botConfig,'./catalogClient':client});
 const id=seed['Розы'][0].id;
 await products.updateStock(id,4);assert.equal((await request('GET')).data['Розы'][0].stock,4);
 const newPhoto=await products.uploadPhoto(png,'image/png');
 const added=await products.saveProduct('Розы',null,{name:'Локальная тестовая роза',price:1234,stock:3,photos:[newPhoto],composition:[],isHit:true});
 let displayed=(await request('GET')).data['Розы'][0];assert.equal(displayed.id,added.id);assert.equal(displayed.images[0],newPhoto);assert.equal(displayed.price,1234);
 await products.saveProduct('Розы',added.id,{name:'Изменённое название',price:1500,stock:2,photos:[newPhoto],composition:[],isHit:true});
 displayed=(await request('GET')).data['Розы'][0];assert.equal(displayed.name,'Изменённое название');assert.equal(displayed.price,1500);
 await products.updateHit(added.id,false);assert.equal((await products.getProductById(added.id)).isHit,false);
 await products.deleteProductById(added.id);assert.equal((await request('GET')).data['Розы'].some(p=>p.id===added.id),false);
 await assert.rejects(products.saveProduct('Розы',added.id,{name:'Deleted',price:1,stock:1,photos:[newPhoto]}),/уже удалён/);
 assert.equal(Object.values((await request('GET')).data).flat().length,53);
 config.catalog.enabled=false;saveConfig();assert.equal((await request('GET')).status,503);
 config.catalog.enabled=true;saveConfig();php.writeFile('/private/catalog/state.json','broken');assert.equal((await request('GET')).status,503);
 console.log('PASS REG catalogue: actual bot/client/PHP cycle for CRUD, stock, hit and photo; baseline 53 products/89 images; auth, revision, retries/conflicts, invalid writes, disabled/corrupt state.');
}
