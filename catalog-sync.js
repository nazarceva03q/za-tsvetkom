'use strict';
// Public catalog URL only; never put storage credentials here.
async function loadDynamicCatalog(){
 const url=document.querySelector('meta[name="catalog-url"]')?.content;
 if(!url)return;
 try{
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error('Catalog HTTP '+response.status);
  const data=await response.json();
  const names=['Букет дня',...categories.slice(1),...balloonCategories];
  if(!data||Array.isArray(data)||!names.every(name=>Array.isArray(data[name])))throw new Error('Invalid catalog');
  const items=names.flatMap(category=>data[category].map(p=>{
   if(!p||typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.images)||!Number.isFinite(p.price))throw new Error('Invalid product');
   return {...p,category,liveCatalog:true};
  })).sort((a,b)=>Number(Boolean(b.isHit))-Number(Boolean(a.isHit)));
  catalog.splice(0,catalog.length,...items.filter(p=>categories.includes(p.category)&&p.category!=='Все'));
  balloonGallery.splice(0,balloonGallery.length,...items.filter(p=>balloonCategories.includes(p.category)));
  allProducts.splice(0,allProducts.length,...items);
  inventoryProducts.splice(0,inventoryProducts.length,...items.filter(p=>!p.madeToOrder&&!p.business));
  window.DAILY_BOUQUETS=items.filter(p=>p.category==='Букет дня');
  for(const id of Object.keys(cart)){const p=items.find(p=>p.id===id);if(!p)delete cart[id];else if(Number.isInteger(p.stock)){cart[id]=Math.min(cart[id],p.stock);if(!cart[id])delete cart[id]}}
  favorites=favorites.filter(id=>items.some(p=>p.id===id));
  render();renderBalloonCatalog();updateCounts();
  const daily=document.querySelector('#dailyOffer');if(daily)daily.innerHTML=window.DAILY_BOUQUETS.slice(0,3).map(card).join('');
 }catch(error){console.warn('Не удалось обновить каталог:',error.message)}
}
loadDynamicCatalog();
