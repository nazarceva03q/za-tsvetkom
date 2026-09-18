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
decorateActions();
const viewer=document.createElement('dialog');viewer.id='photoViewer';viewer.setAttribute('aria-label','Просмотр фотографии');
viewer.innerHTML='<button class="close" aria-label="Закрыть фотографию">×</button><div class="zoom-stage"><img alt=""></div><button class="photo-arrow zoom-prev" aria-label="Предыдущее фото"></button><button class="photo-arrow zoom-next" aria-label="Следующее фото"></button>';
document.body.append(viewer);
let zoomProduct,zoomIndex=0,zoomFocus,previousOverflow;
function drawZoom(){const img=viewer.querySelector('img');img.src=zoomProduct.images[zoomIndex];img.alt=zoomProduct.name+' – фото '+(zoomIndex+1);viewer.querySelectorAll('.photo-arrow').forEach(b=>b.hidden=zoomProduct.images.length<2)}
function moveZoom(delta){zoomIndex=(zoomIndex+delta+zoomProduct.images.length)%zoomProduct.images.length;drawZoom()}
viewer.querySelector('.zoom-prev').innerHTML=chevron(-1);viewer.querySelector('.zoom-next').innerHTML=chevron(1);
viewer.querySelector('.zoom-prev').onclick=()=>moveZoom(-1);viewer.querySelector('.zoom-next').onclick=()=>moveZoom(1);
viewer.querySelector('.close').onclick=()=>viewer.close();
viewer.addEventListener('click',e=>{if(e.target===viewer||e.target.classList.contains('zoom-stage'))viewer.close()});
viewer.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();moveZoom(-1)}if(e.key==='ArrowRight'){e.preventDefault();moveZoom(1)}e.stopPropagation()});
viewer.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;zoomFocus?.focus()});
document.addEventListener('click',e=>{const button=e.target.closest('[data-photo-view]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();const frame=button.closest('.live-photo');zoomProduct=catalog.find(p=>p.id===frame.dataset.photoProduct);if(!zoomProduct?.images.length)return;zoomIndex=Number(frame.dataset.photoIndex);zoomFocus=button;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';drawZoom();viewer.showModal()},true);
polishPhotos();

const headerBurger=$('#headerBurger'),mobileNavigation=$('#mobileNavigation');
mobileNavigation.innerHTML=Array.from($('.topbar nav').querySelectorAll('a')).map(a=>`<a href="${a.getAttribute('href')}">${a.textContent==='Адрес'?'Адрес и время работы':a.textContent}</a>`).join('')+[['Шары','#balloons'],['Праздники','#holidays']].map(([name,href])=>`<a href="${href}">${name}</a>`).join('');
function closeMobileMenu(returnFocus=false){mobileNavigation.hidden=true;headerBurger.setAttribute('aria-expanded','false');headerBurger.setAttribute('aria-label','Открыть меню');if(returnFocus)headerBurger.focus()}
headerBurger.onclick=()=>{const opening=mobileNavigation.hidden;closeMenu();mobileNavigation.hidden=!opening;headerBurger.setAttribute('aria-expanded',String(opening));headerBurger.setAttribute('aria-label',opening?'Закрыть меню':'Открыть меню');if(opening)mobileNavigation.querySelector('a').focus()};
mobileNavigation.addEventListener('click',e=>{if(e.target.closest('a'))closeMobileMenu()});
document.addEventListener('click',e=>{if(!e.target.closest('#mobileNavigation,#headerBurger'))closeMobileMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!mobileNavigation.hidden){e.preventDefault();closeMobileMenu(true)}});
matchMedia('(max-width:1100px)').addEventListener('change',()=>closeMobileMenu());

const searchAction=$('#searchAction');
function updateSearchAction(){const filled=$('#search').value.length>0;searchAction.innerHTML=filled?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>':magnifier;searchAction.setAttribute('aria-label',filled?'Очистить поиск':'Перейти к результатам поиска')}
$('#search').addEventListener('input',updateSearchAction);
searchAction.onclick=()=>{if($('#search').value){$('#search').value='';$('#search').dispatchEvent(new Event('input',{bubbles:true}));$('#search').focus()}else $('#catalog').scrollIntoView({behavior:'smooth'})};
const searchRender=render;render=function(){searchRender();updateSearchAction()};updateSearchAction();

function formatRussianPhone(value){
 let digits=value.replace(/\D/g,'');
 if(!digits)return '';
 if(digits[0]==='8')digits='7'+digits.slice(1);
 else if(digits[0]!=='7')digits='7'+digits;
 digits=digits.slice(0,11);
 const local=digits.slice(1);
 return '+7'+(local.length?' ('+local.slice(0,3):'')+(local.length>=3?')':'')+(local.length>3?' '+local.slice(3,6):'')+(local.length>6?'-'+local.slice(6,8):'')+(local.length>8?'-'+local.slice(8,10):'');
}
const phoneForm=form;
form=function(...args){
 phoneForm(...args);
 const input=$('#requestForm input[name="phone"]');if(!input)return;
 input.inputMode='tel';input.maxLength=18;input.placeholder='+7 (999) 123-45-67';
 input.pattern='[+]7 [(][0-9]{3}[)] [0-9]{3}-[0-9]{2}-[0-9]{2}';
 input.addEventListener('beforeinput',event=>{
  const caret=input.selectionStart;if(event.inputType!=='deleteContentBackward'||caret!==input.selectionEnd||!caret||/\d/.test(input.value[caret-1]))return;
  let start=caret-1;while(start>0&&!/\d/.test(input.value[start]))start--;
  event.preventDefault();input.value=input.value.slice(0,start)+input.value.slice(caret);input.setSelectionRange(start,start);input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 input.addEventListener('input',()=>{
  const old=input.value,position=input.selectionStart,digitPosition=old.slice(0,position).replace(/\D/g,'').length;
  const prefixed=old.replace(/\D/g,'').length&&!/^[78]/.test(old.replace(/\D/g,''));
  input.value=formatRussianPhone(old);
  if(position<old.length){let count=0,caret=0;while(caret<input.value.length&&count<digitPosition+(prefixed?1:0)){if(/\d/.test(input.value[caret]))count++;caret++}input.setSelectionRange(caret,caret)}
  input.setCustomValidity(input.value.replace(/\D/g,'').length===11?'':'Введите номер полностью: 11 цифр, начиная с 7');
 });
};

// Independent price range for balloons; preserve the flower catalogue filter.
const balloonPriceForm=$('#priceFilter').cloneNode(true);
balloonPriceForm.id='balloonPriceFilter';
const balloonIds={priceFrom:'balloonPriceFrom',priceTo:'balloonPriceTo',clearPrice:'clearBalloonPrice',priceError:'balloonPriceError'};
balloonPriceForm.querySelectorAll('[id]').forEach(el=>el.id=balloonIds[el.id]);
balloonPriceForm.querySelectorAll('input').forEach(el=>el.value='');
$('#balloonChips').after(balloonPriceForm);
balloonPriceForm.onsubmit=e=>{e.preventDefault();const min=Number($('#balloonPriceFrom').value||0),max=$('#balloonPriceTo').value===''?Infinity:Number($('#balloonPriceTo').value);if(min<0||max<0||min>max){$('#balloonPriceError').textContent='Сумма «От» должна быть не больше суммы «До».';$('#balloonPriceFrom').focus();return}$('#balloonPriceError').textContent='';balloonPriceMin=min;balloonPriceMax=max;balloonExpanded=false;renderBalloonCatalog()};
$('#clearBalloonPrice').onclick=()=>{balloonPriceMin=0;balloonPriceMax=Infinity;balloonPriceForm.querySelectorAll('input').forEach(el=>el.value='');$('#balloonPriceError').textContent='';balloonExpanded=false;renderBalloonCatalog()};

// Keep a short, visible press response on touch screens without sticky hover.
const pressTargets='footer a:not(.logo-space),.footer-bottom button,#mobileNavigation a,#balloonChips button,.primary,.outline,.toast-go,.offer,.direction,.carousel-arrow:not(:disabled),.product-card,.plain-action,.text-button,.socials button,#favoritesButton,#cartButton,.heart,.topbar nav a,.faq-layout summary,.categories button,#decorChips button,.audio-card,.quiz-banner';
document.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse')return;
 const target=e.target.closest(pressTargets);if(!target)return;
 target.classList.add('is-pressed');
 const end=()=>{setTimeout(()=>target.classList.remove('is-pressed'),220);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end)};
 document.addEventListener('pointerup',end,{once:true});document.addEventListener('pointercancel',end,{once:true});
},{passive:true});

// Footer category shortcut uses the same filter as the balloon tabs.
document.addEventListener('click',e=>{const link=e.target.closest('[data-balloon-link]');if(link){balloonFilter=link.dataset.balloonLink;balloonExpanded=false;renderBalloonCatalog();$('#balloons').scrollIntoView({behavior:'smooth'})}});
