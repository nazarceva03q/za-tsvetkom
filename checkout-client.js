'use strict';
(function(root){
 const clone=x=>JSON.parse(JSON.stringify(x));
 const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 class CheckoutError extends Error{constructor(code,message,uncertain=false){super(message);this.code=code;this.uncertain=uncertain}}
 function validResult(x){return x&&x.ok===true&&x.saved===true&&/^ZT-[A-F0-9]{16}$/.test(x.orderNumber)}
 function createClient({storage,fetch:request,crypto,timeoutMs=20000,locks=null,endpoint='/api/v1/orders.php',previousEndpoint=null}){
  const cloud=endpoint!=='/api/v1/orders.php';
  if(cloud&&!/^https:\/\/functions\.yandexcloud\.net\/[a-z0-9]+$/.test(endpoint))throw new CheckoutError('ENDPOINT','Адрес приёма заявок не настроен.');
  const pendingKey=cloud?'zt:checkout-cloud-v2:'+endpoint:'zt:checkout-pending-v1';
  const previousKey=cloud&&previousEndpoint?'zt:checkout-cloud-v2:'+previousEndpoint:null;
  let active=null,activePayload=null;
  function read(){
   let raw=storage.getItem(pendingKey);
   const migrate=!raw&&previousKey;
   if(migrate)raw=storage.getItem(previousKey);
   if(!raw)return null;
   let x;try{x=JSON.parse(raw)}catch{throw new CheckoutError('STORAGE','Не удалось прочитать состояние предыдущей заявки. Позвоните в магазин.')}
   if(!x||!(cloud?/^\d{13}\.[a-f0-9-]{36}$/:/^[a-f0-9]{64}$/).test(x.key)||!/^[a-f0-9]{64}$/.test(x.fingerprint))throw new CheckoutError('STORAGE','Некорректное состояние предыдущей заявки. Позвоните в магазин.');
   // Preserve the original identity and uncertain outcome when correcting the configured URL.
   if(migrate){storage.setItem(pendingKey,raw);storage.removeItem(previousKey)}
   return x;
  }
  function write(x){storage.setItem(pendingKey,JSON.stringify(x))}
  async function send(payload){
   if(!crypto?.subtle||!crypto?.getRandomValues)throw new CheckoutError('UNSUPPORTED','Откройте сайт по HTTPS в современном браузере.');
   if(cloud&&storage.getItem('zt:checkout-pending-v1'))throw new CheckoutError('PREVIOUS_BACKEND','Есть неподтверждённое состояние прежней заявки. Позвоните в магазин перед новой отправкой.',true);
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(payload))))),n=>n.toString(16).padStart(2,'0')).join('');
   let pending=read();
   if(pending&&pending.fingerprint!==fingerprint)throw new CheckoutError('PENDING','Результат предыдущей заявки ещё не подтверждён. Повторите её с теми же данными или позвоните в магазин; новую заявку пока не отправляем.',true);
   if(pending?.result&&validResult(pending.result))return clone(pending.result);
   if(!pending){
    const random=crypto.getRandomValues(new Uint8Array(32));
    const hex=Array.from(random,n=>n.toString(16).padStart(2,'0')).join('');
    // UUID v4 with a bounded first-use timestamp: erased records cannot be recreated by an old key.
    const uuidBytes=random.slice(0,16);uuidBytes[6]=(uuidBytes[6]&15)|64;uuidBytes[8]=(uuidBytes[8]&63)|128;
    const u=Array.from(uuidBytes,n=>n.toString(16).padStart(2,'0')).join('');
    const key=cloud?Date.now()+'.'+[u.slice(0,8),u.slice(8,12),u.slice(12,16),u.slice(16,20),u.slice(20)].join('-'):hex;
    pending={key,fingerprint,kind:payload.kind,items:payload.items.map(({id,quantity})=>({id,quantity})),uncertain:false};
    write(pending); // Durable key BEFORE network; no contacts stored in browser.
   }
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
    const response=await request(endpoint,{method:'POST',credentials:cloud?'omit':'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
     headers:{'Content-Type':'application/json','Idempotency-Key':pending.key},body:JSON.stringify(payload)});
    const raw=await response.text();if(raw.length>65536)throw new Error('Oversize response');
    const data=JSON.parse(raw);
    if(response.ok&&validResult(data)){
     pending.result={ok:true,saved:true,orderNumber:data.orderNumber,replayed:data.replayed===true};write(pending);return clone(pending.result);
    }
    const definitive=[400,403,409,410,413,415,422,429].includes(response.status)&&data?.ok===false&&data.saved===false;
    if(definitive&&['REQUEST_ERASED','EXPIRED','KEY_EXPIRED'].includes(data.code)){
     // The server's erasure record is definitive even after a lost response.
     // Do not auto-resend; a later explicit submit is a new request with a new key.
     storage.removeItem(pendingKey);pending.uncertain=false;
    }
    else if(definitive&&!pending.uncertain&&!['IDEMPOTENCY_CONFLICT','KEY_CONFLICT'].includes(data.code))storage.removeItem(pendingKey);
    else{pending.uncertain=true;write(pending)}
    const message=typeof data?.message==='string'?data.message.slice(0,500):'Сохранение не подтверждено. Повторите с теми же данными или позвоните.';
    throw new CheckoutError(typeof data?.code==='string'?data.code:'SERVER_ERROR',message,!definitive||pending.uncertain);
   }catch(error){
    if(error instanceof CheckoutError)throw error;
    pending.uncertain=true;try{write(pending)}catch{}
    throw new CheckoutError('NETWORK','Сохранение не подтверждено. Корзина сохранена. Повторите отправку с теми же данными или позвоните в магазин.',true);
   }finally{clearTimeout(timer)}
  }
  function settleCart(){
   const pending=read();if(!pending||!validResult(pending.result))throw new CheckoutError('NOT_SAVED','Сохранение не подтверждено.');
   let cart;try{cart=JSON.parse(storage.getItem('zt:cart')||'{}')}catch{throw new CheckoutError('CART_STORAGE','Заявка сохранена, но корзина не обновлена.')}
   if(!cart||Array.isArray(cart)||typeof cart!=='object')throw new CheckoutError('CART_STORAGE','Заявка сохранена, но корзина не обновлена.');
   const before=JSON.stringify(stable(cart));
   if(!pending.settlement){
    const next={...cart};
    if(pending.kind==='order')for(const item of pending.items){
     const count=Number.isInteger(next[item.id])?next[item.id]:0;
     if(count<=item.quantity)delete next[item.id];else next[item.id]=count-item.quantity;
    }
    pending.settlement={before,after:JSON.stringify(stable(next))};write(pending);
   }
   // A crash after writing the cart must not subtract quantities a second time.
   const state=pending.settlement;let preserved=false;
   if(before===state.before){storage.setItem('zt:cart',state.after);cart=JSON.parse(state.after)}
   else if(before!==state.after)preserved=true;
   storage.removeItem(pendingKey);
   return {cart,result:clone(pending.result),preserved};
  }
  return {read,settleCart,submit(payload){
   const serialized=JSON.stringify(stable(payload));
   if(active){if(serialized!==activePayload)return Promise.reject(new CheckoutError('BUSY','Другая заявка ещё сохраняется. Дождитесь результата.'));return active}
   activePayload=serialized;
   const operation=()=>send(clone(payload));
   active=(locks?locks.request('zt-checkout',operation):operation()).finally(()=>{active=null;activePayload=null});
   return active;
  }};
 }
 const api={createClient,CheckoutError,validResult};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ZTCheckoutClient=api;
})(globalThis);
