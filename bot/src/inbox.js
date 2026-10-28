'use strict';
// Read through REG on each click. Customer data never enters bot sessions/S3.
const config=require('./config');
const vk=require('./vkApi');
function allowed(userId) {
  return (config.adminChatIds||[]).some(id=>String(id)===String(userId));
}
function endpoint() {
  const url=new URL(config.regInboxUrl);
  const site=new URL(config.siteBaseUrl);
  if(url.protocol!=='https:'||url.origin!==site.origin||url.username||url.password||url.search||url.hash
      ||url.pathname!=='/api/v1/bot-inbox.php')throw Error('INBOX_CONFIG');
  if(!/^[a-f0-9]{64}$/.test(config.regInboxSecret||''))throw Error('INBOX_CONFIG');
  return url;
}
async function read(userId,query) {
  if(!allowed(userId))throw Error('INBOX_FORBIDDEN');
  const url=endpoint();
  for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
  const r=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'X-ZT-Inbox-Key':config.regInboxSecret,'X-ZT-Viewer-ID':String(userId)}});
  if(!r.ok){const e=Error('INBOX_HTTP');e.status=r.status;throw e;}
  const chunks=[];let length=0;
  for await(const chunk of r.body){length+=chunk.length;if(length>2*1024*1024)throw Error('INBOX_SIZE');chunks.push(Buffer.from(chunk));}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(data.ok!==true)throw Error('INBOX_RESPONSE');
  return data;
}
const back=()=>[vk.callbackButton('⬅️ В меню','admin:menu')];
function detailRows(number,offset=0) {
  return [[vk.callbackButton('Обновить заявку','inbox:open:'+number)],
    [vk.callbackButton('⬅️ Список заявок','admin:leads:'+offset)],back()];
}
async function failed(userId,error) {
  const message=error.status===404?'Заявка не найдена или её данные уже очищены.':
    error.status===403?'Доступ к заявкам ещё не настроен для вашей страницы VK.':
    'Не удалось загрузить заявки с REG.RU. Попробуйте позже. Сохранённые заявки остаются на сервере.';
  await vk.sendMessage({userId},message,[[vk.callbackButton('Повторить','admin:leads')],back()]);
}
async function list(userId,offset=0) {
  if(!allowed(userId))return;
  if(!Number.isSafeInteger(offset)||offset<0||offset>999999)return;
  let data;try{data=await read(userId,{offset});}catch(e){return failed(userId,e);}
  const rows=(data.items||[]).map((r,i)=>[vk.callbackButton('Открыть '+(offset+i+1),'inbox:open:'+r.number+':'+offset)]);
  const nav=[];
  if(offset>0)nav.push(vk.callbackButton('← Новее','admin:leads:'+Math.max(0,offset-4)));
  if(data.hasMore)nav.push(vk.callbackButton('Старее →','admin:leads:'+(offset+4)));
  if(nav.length)rows.push(nav);rows.push(back());
  const text=(data.items||[]).length?'Заявки сайта · новые сверху\n\n'+data.items.map((r,i)=>
    `${offset+i+1}. ${r.type}\n${r.createdAt}\n${r.name}\n${r.subject}\n${r.number}`).join('\n\n'):
    'Заявок пока нет. Здесь появятся сохранённые обращения с сайта.';
  await vk.sendMessage({userId},text,rows);
}
function overview(r) {
  const lines=['Заявка '+r.number,r.createdAt,'Раздел / форма сайта: '+r.type,'Тема: '+r.subject,'Имя: '+r.name];
  for(const f of r.fields||[])lines.push(f.label+': '+f.value);
  if(Number.isInteger(r.previousRequests))lines.push(r.previousRequests>0?
    'Повторное обращение: ранее заявок с этим телефоном — '+r.previousRequests+'.':
    'Первое обращение с этим телефоном среди сохранённых заявок.');
  else lines.push('Историю обращений определить нельзя: телефон отсутствует.');
  lines.push('Сравнение по телефону не подтверждает личность или факт покупки. Удалённые обращения не учитываются.');
  lines.push('Цена, наличие и исполнение согласуются с покупателем.');
  return lines.join('\n');
}
function productText(r,index,photo) {
  const p=r.items[index];
  const lines=['Заявка '+r.number,`Товар ${index+1} из ${r.items.length}: ${p.name}`,
    p.referenceOnly?'Пример для обсуждения, не заказ 1 штуки.':'Количество: '+p.quantity+' шт.'];
  if(p.category)lines.push('Раздел каталога: '+p.category);
  if(p.priceLabel)lines.push('Цена на момент обращения (не подтверждена): '+p.priceLabel);
  if(p.description)lines.push('Состав / описание: '+p.description);
  if(p.note)lines.push('Дополнительно: '+p.note);
  if(p.photos?.length)lines.push(`Фото ${photo+1} из ${p.photos.length} · снимок карточки при обращении`);
  else lines.push('Фото при подаче этой заявки не сохранено.');
  return lines.join('\n');
}
async function open(userId,number,index=null,photo=0,offset=0) {
  if(!allowed(userId)||!/^ZT-[A-F0-9]{16}$/.test(number))return;
  let data;try{data=await read(userId,{number});}catch(e){return failed(userId,e);}
  const r=data.request;
  if(!r||r.number!==number)throw Error('INBOX_RESPONSE');
  if(index===null) {
    const rows=detailRows(number,offset);
    if(r.items?.length)rows.unshift([vk.callbackButton('Товары и фотографии ('+r.items.length+')','inbox:item:'+number+':0:0:'+offset)]);
    await vk.sendMessage({userId},overview(r),rows);
    return;
  }
  if(!Number.isSafeInteger(index)||index<0||index>=r.items.length)return;
  const p=r.items[index];
  if(!Number.isSafeInteger(photo)||photo<0||photo>=Math.max(1,p.photos.length))return;
  const command=(i,f)=>'inbox:item:'+number+':'+i+':'+f+':'+offset;
  const rows=[],nav=[];
  if(index>0)nav.push(vk.callbackButton('← Товар',command(index-1,0)));
  if(index+1<r.items.length)nav.push(vk.callbackButton('Товар →',command(index+1,0)));
  if(nav.length)rows.push(nav);
  const photos=[];
  if(photo>0)photos.push(vk.callbackButton('← Фото',command(index,photo-1)));
  if(photo+1<p.photos.length)photos.push(vk.callbackButton('Фото →',command(index,photo+1)));
  if(photos.length)rows.push(photos);
  rows.push(...detailRows(number,offset));
  const text=productText(r,index,photo);
  let url=null;
  try{url=new URL(p.photos[photo]);if(url.origin!==new URL(config.siteBaseUrl).origin||url.protocol!=='https:')url=null;}catch{}
  if(url){const sent=await vk.sendPhotoUrlMessage({userId},text,rows,url.href,{photoTimeoutMs:8000});if(sent?.ok)return;}
  await vk.sendMessage({userId},text+(url?'\nФото временно не загрузилось. Остальные данные заявки доступны.':''),rows);
}
async function handle(userId,command) {
  if(!command.startsWith('inbox:'))return false;
  if(!allowed(userId))return true;
  const parts=command.split(':');
  if(parts[1]==='open'&&parts.length<=4&&/^\d{1,6}$/.test(parts[3]||'0'))await open(userId,parts[2],null,0,Number(parts[3]||0));
  if(parts[1]==='item'&&parts.length===6&&parts.slice(3).every(v=>/^\d{1,6}$/.test(v)))
    await open(userId,parts[2],Number(parts[3]),Number(parts[4]),Number(parts[5]));
  return true;
}
module.exports={list,open,handle,overview,productText,read};
