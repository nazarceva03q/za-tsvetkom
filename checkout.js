'use strict';
(function(){
 let client;
 function getClient(){
  if(!client)client=ZTCheckoutClient.createClient({storage:localStorage,fetch:window.fetch.bind(window),crypto:window.crypto,locks:navigator.locks||null});
  return client;
 }
 function showSaved(result,note=''){
  if(!ZTCheckoutClient.validResult(result)){toast('Сохранение заявки не подтверждено.');return}
  openModal('<h2 class="modal-title">Заявка сохранена</h2><p id="savedOrderNumber"></p><p>Это заявка на согласование. Цену, наличие, время и доставку подтвердит флорист. Онлайн-оплаты нет.</p><p>Для срочного подтверждения позвоните в магазин.</p><p id="savedOrderNote" role="status"></p>'+contactButtons(),'contacts');
  document.querySelector('#savedOrderNumber').textContent='Номер заявки: '+result.orderNumber;
  document.querySelector('#savedOrderNote').textContent=note;
 }
 function payloadFor(f,order){
  const v=new FormData(f);
  const items=order?Object.entries(cart).sort(([a],[b])=>a.localeCompare(b)).map(([id,quantity])=>{
   const p=allProducts.find(p=>p.id===id);
   if(!p||p.placeholder||p.business||!Number.isInteger(quantity)||quantity<1)throw new ZTCheckoutClient.CheckoutError('INVALID_CART','Проверьте корзину. Предложение без заполненной карточки заказать нельзя.');
   return {id,quantity,name:String(p.name||'').trim()};
  }):[];
  if(order&&!items.length)throw new ZTCheckoutClient.CheckoutError('INVALID_CART','Корзина пуста.');
  const number=name=>v.get(name)?Number(v.get(name)):null;
  const subject=String(v.get('subject')||'').trim();
  const requestType=order?'cart':subject.includes('Корпоратив')?'corporate':subject.includes('Большой букет')?'large':subject==='Задать вопрос'?'question':subject.includes('Предзаказ')?'preorder':subject.includes('Подбор')?'gift':'other';
  return {kind:order?'order':'inquiry',requestType,subject:String(v.get('subject')||'').trim(),name:String(v.get('name')||'').trim(),
   phone:String(v.get('phone')||'').replace(/\D/g,''),channel:String(v.get('channel')||'Телефон'),date:String(v.get('date')||''),
   delivery:order?String(v.get('delivery')||''):'',time:order?String(v.get('time')||''):'',
   address:order&&v.get('delivery')==='Доставка'?String(v.get('address')||'').trim():'',
   comment:String(v.get('comment')||'').trim(),consent:v.get('consent')==='on',consentVersion:'2026-10-requests-v2',
   quantity:number('quantity'),budget:number('budget'),items,website:String(v.get('website')||'')};
 }
 function formError(f,message){
  let target=f.querySelector('[data-submit-error]');
  if(!target){target=document.createElement('p');target.className='full form-note';target.dataset.submitError='';target.setAttribute('role','alert');target.tabIndex=-1;f.append(target)}
  target.textContent=message;target.focus();
 }
 async function submitForm(f,{order}){
  if(f.dataset.submitting==='true'||f.dataset.completed==='true')return;
  const button=f.querySelector('button[type="submit"]');
  let editable=[];
  f.dataset.submitting='true';if(button){button.disabled=true;button.textContent='Сохраняем…'}
  try{
   localStorage.setItem('zt:cart',JSON.stringify(cart));
   const payload=payloadFor(f,order);
   editable=[...f.querySelectorAll('input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
   for(const field of editable)field.disabled=true;
   const result=await getClient().submit(payload);
   let note='';
   try{
    const settled=getClient().settleCart();cart=settled.cart;
    if(settled.preserved)note='Корзина изменялась в другом окне и оставлена для проверки.';
    updateCounts();render();renderBalloonCatalog();
   }catch{note='Заявка уже сохранена. Не отправляйте её заново; корзину проверьте отдельно.'}
   f.dataset.completed='true';showSaved(result,note);
  }catch(error){formError(f,error instanceof ZTCheckoutClient.CheckoutError?error.message:'Не удалось подготовить безопасную отправку. Корзина сохранена. Проверьте разрешение браузера на хранение данных или позвоните в магазин.')}
  finally{for(const field of editable)field.disabled=false;f.dataset.submitting='false';if(button){button.disabled=false;button.textContent='Отправить заявку'}}
 }
 window.ZTCheckout={submitForm,showSaved};
 try{
  const pending=getClient().read();
  if(pending?.result&&ZTCheckoutClient.validResult(pending.result)){
   const settled=getClient().settleCart();cart=settled.cart;updateCounts();
   showSaved(settled.result,settled.preserved?'Корзина оставлена для проверки.':'');
  }
 }catch{/* No network requests on startup. */}
})();
