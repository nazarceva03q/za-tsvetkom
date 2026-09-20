'use strict';
const previousCard=card,previousDetail=detail;
// Show each complete photograph only after decoding; retain the current slide while the next loads.
function revealProductPhoto(img){const source=img.currentSrc||img.src;img.decode().then(()=>{if((img.currentSrc||img.src)===source)img.classList.add('is-loaded')}).catch(()=>{})}
document.addEventListener('load',event=>{if(event.target.matches?.('.live-photo img'))revealProductPhoto(event.target)},true);
async function loadCompletePhoto(img,src,alt){
 const request={};img.photoRequest=request;
 const next=new Image();next.src=src;
 try{await next.decode()}catch{return false}
 if(img.photoRequest!==request||!img.isConnected)return false;
 img.src=src;img.alt=alt;img.classList.add('is-loaded');return true;
}
const magnifier='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
const compositionParts=p=>p.description.split(' · ').filter(part=>!/^высота/i.test(part));
const capitalizePart=part=>part.replace(/^(\d+\s+)?(\p{L})/u,(_,number,letter)=>(number||'')+letter.toUpperCase());
function productComposition(p){return p.placeholder?'<p class="product-composition">Описание</p>':`<div class="product-composition"><p>В состав входит:</p><ul>${compositionParts(p).map(part=>`<li>${esc(capitalizePart(part))}</li>`).join('')}</ul></div>`}
function productNote(p){return [p.description.split(' · ').find(part=>/^высота/i.test(part)),p.note].filter(Boolean).map(capitalizePart).join(' · ')}
function productInformation(){return '<div class="product-information"><p>Стоимость и время доставки согласовываются с менеджером после оформления заказа. Оплата производится после подтверждения заказа.</p><p>Доставка рассчитывается индивидуально после получения адреса и пожеланий по времени.</p><p>Для сохранения свежести при перевозке цветы можно поставить на воду в аквабоксе. По желанию добавим открытку.</p><p>Фото передаёт общий вид и цветовую гамму букета. Итоговая композиция может немного отличаться по оттенку цветов и деталям оформления – это особенность работы с живыми цветами и ручной сборки. Состав и стиль букета при этом сохраняются.</p><p>Оформление может отличаться в зависимости от наличия материалов. По вашему желанию подберём другую упаковку.</p></div>'}
displayName=p=>p.slug?esc(p.name):'Название';
displayPrice=p=>p.business?businessPrice(p):p.slug?money(p.price):'Цена';
cartPrice=function(){const items=allProducts.filter(p=>cart[p.id]);const total=items.filter(p=>p.slug).reduce((s,p)=>s+p.price*cart[p.id],0);return items.some(p=>!p.slug)?(total?money(total)+' + шары по согласованию':'Уточнит флорист'):money(total)};
function productPhotos(p){return `<div class="photo live-photo" data-photo-product="${p.id}" data-photo-index="0">${p.images.length?`<button class="product-photo-button" data-photo-view aria-label="Открыть фото: ${esc(p.name)}"><img src="${p.images[0]}" alt="${esc(p.name)} – фото 1" loading="lazy" width="720" height="960"></button><button class="photo-zoom" data-photo-view aria-label="Увеличить фото: ${esc(p.name)}">${magnifier}</button>`:'<span class="camera" aria-hidden="true"></span><span class="photo-label">Фото скоро появится</span>'}<button class="heart ${favorites.includes(p.id)?'selected':''}" data-fav="${p.id}" aria-label="В избранное: ${esc(p.name)}" aria-pressed="${favorites.includes(p.id)}">${favorites.includes(p.id)?'♥':'♡'}</button>${p.badge?`<span class="badge">${esc(p.badge)}</span>`:''}${p.images.length>1?`<button class="photo-arrow photo-prev" data-photo-step="-1" aria-label="Предыдущее фото">‹</button><button class="photo-arrow photo-next" data-photo-step="1" aria-label="Следующее фото">›</button><span class="photo-counter" aria-live="polite">1 / ${p.images.length}</span>`:''}</div>`}
card=function(p,mode=false){if(p.business)return businessCard(p);if(!p.slug)return previousCard(p,mode);const basket=mode==='cart',favorite=mode===true;return `<article class="product-card ${p.madeToOrder?'balloon-bouquet-card':''}">${productPhotos(p)}<div class="product-info"><h3><button data-detail="${p.id}">${esc(p.name)}</button></h3>${productComposition(p)}<p class="product-note">${esc(productNote(p))}</p><strong class="product-price">${money(p.price)}</strong>${basket?`<div class="quantity"><button data-qty="${p.id}" data-delta="-1" aria-label="Уменьшить количество">−</button><span>${cart[p.id]}</span><button data-qty="${p.id}" data-delta="1" aria-label="Увеличить количество">+</button><button class="remove-product" data-remove="${p.id}" aria-label="Удалить товар">×</button></div>`:`<div class="product-actions">${p.madeToOrder?`<button class="primary" data-form="Букет из шаров: ${esc(p.name)}">Обсудить заказ</button>`:`<button class="primary" data-add="${p.id}">В корзину</button>`}</div>`}</div></article>`};
detail=function(id){const p=allProducts.find(p=>p.id===id);if(!p)return;if(p.business){openModal(businessCard(p),'detail');return}if(!p.slug)return previousDetail(id);openModal(`<article class="product-detail ${p.madeToOrder?'balloon-bouquet-card':''}"><h2 class="modal-title">${esc(p.name)}</h2>${productPhotos(p)}${productComposition(p)}<p>${esc(productNote(p))}</p><strong class="product-price">${money(p.price)}</strong><p>${p.madeToOrder?'Срок изготовления и детали заказа согласует флорист':'Наличие и окончательную стоимость подтвердит флорист'}</p><div class="stack-actions">${p.madeToOrder?`<button class="primary" data-form="Букет из шаров: ${esc(p.name)}">Обсудить заказ</button>`:`<button class="primary" data-add="${p.id}">В корзину</button>`}</div></article>`,'detail')};
async function moveProductPhoto(frame,delta){
 const p=allProducts.find(p=>p.id===frame.dataset.photoProduct);if(!p||p.images.length<2)return;
 const i=(Number(frame.dataset.pendingPhotoIndex??frame.dataset.photoIndex)+delta+p.images.length)%p.images.length;
 frame.dataset.pendingPhotoIndex=i;
 if(!await loadCompletePhoto(frame.querySelector('img'),p.images[i],p.name+' – фото '+(i+1)))return;
 frame.dataset.photoIndex=i;delete frame.dataset.pendingPhotoIndex;
 frame.querySelector('.photo-counter').textContent=(i+1)+' / '+p.images.length;
 if(p.business){const article=frame.closest('article');article.querySelector('.business-photo-price').textContent=businessPhotoPrice(p,i);article.querySelector('[data-form]').dataset.form=businessRequest(p,i)}
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-photo-step]');if(button)moveProductPhoto(button.closest('[data-photo-product]'),Number(button.dataset.photoStep))});
function businessPrice(p){return (p.price===p.maxPrice?money(p.price):money(p.price)+' – '+money(p.maxPrice))+(p.perStand?' за 1 стойку':'')}
function businessPhotoPrice(p,index){return 'Оформление на фото: '+money(p.photoPrices[index])+(p.perStand?' за 1 стойку':'')}
function businessRequest(p,index){return p.name+' – фото '+(index+1)+', '+money(p.photoPrices[index])+(p.perStand?' за 1 стойку':'')}
function businessCard(p){return `<article class="product-card business-card">${productPhotos(p)}<div class="product-info"><h3><button data-detail="${p.id}">${esc(p.name)}</button></h3><div><p class="business-photo-price" aria-live="polite">${esc(businessPhotoPrice(p,0))}</p><p>${esc(p.description)}</p></div><p class="product-note">${esc(p.note)}</p><strong class="product-price">${businessPrice(p)}</strong><div class="product-actions"><button class="primary" data-form="${esc(businessRequest(p,0))}">Обсудить оформление</button></div></div></article>`}
render();renderBalloonCatalog();updateCounts();
