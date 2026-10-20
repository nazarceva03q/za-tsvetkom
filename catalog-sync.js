'use strict';
// Public catalogue only: credentials never belong in this script.
window.ZTCatalogState={mode:'static',connected:false};
let catalogLoading=false;
function catalogNotice(message){
 let notice=document.querySelector('#catalogConnectionNotice');
 if(!notice){notice=document.createElement('p');notice.id='catalogConnectionNotice';notice.className='form-note';notice.setAttribute('role','status');document.querySelector('#catalog')?.prepend(notice);}
 notice.textContent=message;notice.hidden=!message;
}
function catalogImage(value){
 if(typeof value!=='string'||!value||/["'<>\\\\\s]/.test(value))throw Error('Invalid photo URL');
 const url=new URL(value,location.href);
 if(url.protocol!=='https:'&&url.origin!==location.origin)throw Error('Insecure photo URL');
 if(!['http:','https:'].includes(url.protocol))throw Error('Invalid photo protocol');
 return value;
}
function normalizeCloudCatalog(data){
 const names=['Букет дня',...categories.slice(1),...balloonCategories];
 if(!data||Array.isArray(data)||!names.every(n=>Array.isArray(data[n])))throw Error('Incomplete catalog');
 const seen=new Set();
 const items=names.flatMap(category=>data[category].map(p=>{
  if(!p||typeof p.id!=='string'||!/^[a-z0-9-]{1,100}$/.test(p.id)||seen.has(p.id)||p.category!==category||
   typeof p.name!=='string'||!p.name.trim()||p.name.length>255||!Array.isArray(p.images)||p.images.length>20||
   !Number.isFinite(p.price)||p.price<=0||p.price>10000000||
   (p.stock!==null&&(!Number.isInteger(p.stock)||p.stock<0||p.stock>10000)))throw Error('Invalid product');
  seen.add(p.id);
  for(const k of ['description','note','badge','tags'])if(p[k]!==undefined&&typeof p[k]!=='string')throw Error('Invalid product text');
  if(p.business&&(!Array.isArray(p.photoPrices)||p.photoPrices.length!==p.images.length||!p.images.length||
   !p.photoPrices.every(v=>Number.isFinite(v)&&v>0)||p.price!==Math.min(...p.photoPrices)||p.maxPrice!==Math.max(...p.photoPrices)))throw Error('Invalid business prices');
  return {...p,id:p.id,slug:p.id,name:p.name.trim(),description:p.description||'',note:p.note||'',badge:p.badge||'',tags:p.tags||'',
   images:p.images.map(catalogImage),category,liveCatalog:true};
 }));
 if(items.length>5000)throw Error('Catalog too large');
 return items.sort((a,b)=>Number(Boolean(b.isHit))-Number(Boolean(a.isHit)));
}
async function loadDynamicCatalog(){
 const url=document.querySelector('meta[name="catalog-url"]')?.content;
 if(!url||catalogLoading)return false;
 catalogLoading=true;
 try{
  const target=new URL(url,location.href);
  if(target.protocol!=='https:'&&target.origin!==location.origin)throw Error('Invalid catalog endpoint');
  const response=await fetch(target.href,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Catalog HTTP '+response.status);
  const items=normalizeCloudCatalog(await response.json());
  catalog.splice(0,catalog.length,...items.filter(p=>categories.includes(p.category)&&p.category!=='Все'));
  balloonGallery.splice(0,balloonGallery.length,...items.filter(p=>balloonCategories.includes(p.category)));
  allProducts.splice(0,allProducts.length,...items);
  inventoryProducts.splice(0,inventoryProducts.length,...items.filter(p=>!p.madeToOrder&&!p.business));
  window.DAILY_BOUQUETS=items.filter(p=>p.category==='Букет дня');
  // A pending request must retain its original basket until its result is resolved.
  let pending=true;try{pending=localStorage.getItem('zt:checkout-pending-v1')}catch{/* Keep basket if storage cannot be inspected. */}
  if(!pending){
   for(const id of Object.keys(cart)){const p=items.find(p=>p.id===id);if(!p||p.business||p.madeToOrder)delete cart[id];else if(Number.isInteger(p.stock)){cart[id]=Math.min(cart[id],p.stock);if(!cart[id])delete cart[id]}}
   favorites=favorites.filter(id=>items.some(p=>p.id===id));
  }
  window.ZTCatalogState={mode:'live',connected:true,updatedAt:Date.now()};
  catalogNotice('');render();renderBalloonCatalog();updateCounts();
  const daily=document.querySelector('#dailyOffer');if(daily)daily.innerHTML=window.DAILY_BOUQUETS.slice(0,3).map(card).join('');
  if(modalMode==='cart')showCart();
  return true;
 }catch(error){
  // Preserve visible products, but never present stale stock as authoritative.
  for(const p of allProducts)p.stock=null;
  window.ZTCatalogState={mode:'fallback',connected:false};
  catalogNotice('Обновление каталога временно недоступно. Показана резервная витрина. Актуальность товаров, цену и наличие уточните у флориста.');
  render();renderBalloonCatalog();
  if(modalMode==='cart')showCart();
  console.warn('Не удалось обновить каталог:',error.message);
  return false;
 }finally{catalogLoading=false}
}
// This file is also included at the end of HTML: wait for all deferred renderers.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>loadDynamicCatalog(),{once:true});
else loadDynamicCatalog();
