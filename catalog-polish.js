'use strict';
$('#catalog .demo-note')?.remove();
$('#reviews [data-social="Яндекс Карты"]')?.remove();
$('#clearPrice').textContent='Сбросить';
const chevron=direction=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction<0?'M14 6l-6 6 6 6':'M10 6l6 6-6 6'}"/></svg>`;
function polishPhotos(){document.querySelectorAll('.photo-arrow').forEach(b=>{if(!b.querySelector('svg'))b.innerHTML=chevron(Number(b.dataset.photoStep))});document.querySelectorAll('.heart').forEach(b=>{const selected=favorites.includes(b.dataset.fav);b.setAttribute('aria-pressed',String(selected));b.classList.toggle('selected',selected);b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" fill="${selected?'currentColor':'none'}"/></svg>`})}
// Run after each catalogue/modal render without observing our own SVG mutations.
const polishRender=render;render=function(){polishRender();polishPhotos()};
const polishOpen=openModal;openModal=function(...args){polishOpen(...args);polishPhotos()};
document.addEventListener('click',()=>queueMicrotask(polishPhotos));
document.querySelectorAll('.carousel-arrow').forEach(b=>b.innerHTML=chevron(Number(b.dataset.dir)));
for(const [name,body,url] of [['Валерия','Отличный магазин, свежие цветы'],['Егор Коробейников','Вежливый персонал, красивые букеты'],['@Nikitos_Reshaet','Жена довольна, а это самое главное','https://vk.ru/id184516710']]){
const example=$('#reviewTrack article').cloneNode(true);const h=example.querySelector('h3');h.textContent=name;if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=name;h.replaceChildren(a)}example.querySelector('p').textContent=body;$('#reviewTrack').append(example)}
updateCarousel('reviewTrack');
$('#loadMap')?.click();
const viewer=document.createElement('dialog');viewer.id='photoViewer';viewer.setAttribute('aria-label','Просмотр фотографии');viewer.innerHTML='<button class="close" aria-label="Закрыть фотографию">×</button><div class="zoom-stage"><img alt=""></div><button class="photo-arrow zoom-prev" aria-label="Предыдущее фото"></button><button class="photo-arrow zoom-next" aria-label="Следующее фото"></button><div class="zoom-tools"><button class="outline zoom-toggle">Увеличить</button><a class="outline zoom-original" target="_blank" rel="noopener">Открыть оригинал</a><span aria-live="polite"></span></div>';document.body.append(viewer);
let zoomProduct,zoomIndex=0,zoomFocus,previousOverflow;
function drawZoom(){const src=zoomProduct.images[zoomIndex],img=viewer.querySelector('img');img.src=src;img.alt=zoomProduct.name+' – фото '+(zoomIndex+1);viewer.querySelector('.zoom-original').href=src;viewer.querySelector('.zoom-tools span').textContent=(zoomIndex+1)+' / '+zoomProduct.images.length;viewer.querySelectorAll('.photo-arrow').forEach(b=>b.hidden=zoomProduct.images.length<2);viewer.classList.remove('enlarged');viewer.querySelector('.zoom-toggle').textContent='Увеличить'}
function moveZoom(delta){zoomIndex=(zoomIndex+delta+zoomProduct.images.length)%zoomProduct.images.length;drawZoom()}
viewer.querySelector('.zoom-prev').innerHTML=chevron(-1);viewer.querySelector('.zoom-next').innerHTML=chevron(1);
viewer.querySelector('.zoom-prev').onclick=()=>moveZoom(-1);viewer.querySelector('.zoom-next').onclick=()=>moveZoom(1);
viewer.querySelector('.close').onclick=()=>viewer.close();
viewer.querySelector('.zoom-toggle').onclick=()=>{const large=viewer.classList.toggle('enlarged');viewer.querySelector('.zoom-toggle').textContent=large?'Уменьшить':'Увеличить'};
viewer.querySelector('img').onclick=()=>viewer.querySelector('.zoom-toggle').click();
viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close()});
viewer.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();moveZoom(-1)}if(e.key==='ArrowRight'){e.preventDefault();moveZoom(1)}e.stopPropagation()});
viewer.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;zoomFocus?.focus()});
document.addEventListener('click',e=>{const button=e.target.closest('.live-photo .product-photo-button');if(!button)return;e.preventDefault();e.stopImmediatePropagation();const frame=button.closest('.live-photo');zoomProduct=catalog.find(p=>p.id===frame.dataset.photoProduct);zoomIndex=Number(frame.dataset.photoIndex);zoomFocus=button;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';drawZoom();viewer.showModal()},true);
polishPhotos();

// Show the real daily selection when the shop supplies its current entries.
if(window.DAILY_BOUQUETS?.length){
 const daily=document.createElement('div');daily.className='product-grid daily-bouquets';
 daily.innerHTML=window.DAILY_BOUQUETS.slice(0,3).map(p=>card(p)).join('');
 $('#offers .offer')?.remove();$('#offers').append(daily);polishPhotos();
}
// Keep a short, visible press response on touch screens without sticky hover.
const pressTargets='.primary,.outline,.toast-go,.offer,.direction,.carousel-arrow:not(:disabled),.product-card,.plain-action,.text-button,.socials button,#favoritesButton,#cartButton,.heart,.topbar nav a,.faq-layout summary,.categories button,#decorChips button,.audio-card,.quiz-banner';
document.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse')return;
 const target=e.target.closest(pressTargets);if(!target)return;
 target.classList.add('is-pressed');
 const end=()=>{setTimeout(()=>target.classList.remove('is-pressed'),220);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end)};
 document.addEventListener('pointerup',end,{once:true});document.addEventListener('pointercancel',end,{once:true});
},{passive:true});
