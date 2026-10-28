// Only authenticated notifications of requests ALREADY saved on REG.RU.
// Catalog/photos live on REG. Private receipts contain no customer details.
const crypto = require('crypto');
const config = require('./config');
const storage = require('./objectStorage');
const vk = require('./vkApi');
const requestPanel = require('./requestPanel');
function authorized(headers, secret) {
  const values = Object.entries(headers || {}).filter(([key]) => key.toLowerCase() === 'x-relay-key');
  if (!/^[a-f0-9]{64,128}$/.test(secret || '') || values.length !== 1 || typeof values[0][1] !== 'string') return false;
  const actual = Buffer.from(values[0][1]), expected = Buffer.from(secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function valid(data) {
  const fields = 'message,notificationId,orderNumber,randomId,recipientId,type';
  const timedFields = 'issuedAt,' + fields;
  return data && !Array.isArray(data) &&
    [fields,timedFields].includes(Object.keys(data).sort().join(',')) &&
    (!Object.hasOwn(data,'issuedAt') || (Number.isSafeInteger(data.issuedAt) && data.issuedAt > 0)) &&
    data.type === 'site.lead.saved' && /^[1-9][0-9]{0,19}$/.test(data.notificationId) &&
    typeof data.notificationId === 'string' && /^ZT-[A-F0-9]{16}$/.test(data.orderNumber) &&
    typeof data.recipientId === 'string' && /^[1-9][0-9]{0,15}$/.test(data.recipientId) &&
    Number.isInteger(data.randomId) && data.randomId > 0 && data.randomId <= 2147483647 &&
    typeof data.message === 'string' && [...data.message].length > 0 && [...data.message].length <= 4096 &&
    data.message.includes(data.orderNumber) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.message);
}
async function deliver(data, deps = {}) {
  const cfg = deps.config || config;
  if (!valid(data)) return {status:400, body:{ok:false,code:'INVALID_RELAY'}};
  // This is the immutable queue creation time, NOT the age of a menu button.
  // Check before reading receipts: expired payloads cannot be replayed after GC.
  const timed = Object.hasOwn(data,'issuedAt');
  const now = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  if (!timed && cfg.siteRelayRequireExpiry) return {status:409,body:{ok:false,code:'RELAY_EXPIRY_REQUIRED'}};
  if (timed && (data.issuedAt > now + 300 || now - data.issuedAt >= 86400))
    return {status:409,body:{ok:false,code:'RELAY_EXPIRED'}};
  if (!cfg.ownerChatId || data.recipientId !== String(cfg.ownerChatId))
    return {status:409,body:{ok:false,code:'OWNER_MISMATCH'}};
  if (!cfg.s3?.bucket || !cfg.s3.accessKey || !cfg.s3.secretKey || !cfg.botToken)
    return {status:503,body:{ok:false,code:'RELAY_NOT_CONFIGURED'}};
  const read = deps.read || ((key) => storage.getJson(cfg.s3,key,null));
  const write = deps.write || ((key,value) => storage.putJson(cfg.s3,key,value));
  const send = deps.send || ((params) => vk.callApi('messages.send', params));
  const identity = crypto.createHash('sha256').update(data.orderNumber+':'+data.notificationId).digest('hex')+'.json';
  const key = (timed ? 'site_notifications_v2/' : 'site_notifications/') + identity;
  const hash = crypto.createHash('sha256').update(JSON.stringify([data.type,data.notificationId,data.orderNumber,data.recipientId,data.randomId,data.message])).digest('hex');
  try {
    let previous = await read(key);
    // Rolling upgrade: a previously delivered legacy job must not be sent again
    // just because the sender gained an issuance timestamp. Do not refresh TTL.
    if (!previous && timed) previous = await read('site_notifications/' + identity);
    if (previous) {
      if (previous.hash !== hash) return {status:409,body:{ok:false,code:'RELAY_CONFLICT'}};
      if (previous.issuedAt !== undefined && previous.issuedAt !== data.issuedAt)
        return {status:409,body:{ok:false,code:'RELAY_CONFLICT'}};
      if (!Number.isInteger(previous.messageId) || previous.messageId<=0) throw Error('INVALID_RECEIPT');
      return {status:200,body:{ok:true,delivered:true,notificationId:data.notificationId,randomId:data.randomId,messageId:previous.messageId}};
    }
    // A lost response or concurrent function invocation reuses the SAME VK random_id.
    const keyboard={inline:true,buttons:[[{action:{type:'open_link',label:'Открыть заявку',link:requestPanel.urlFor(cfg,data.orderNumber)}}],
      [{action:{type:'open_link',label:'Все заявки',link:requestPanel.urlFor(cfg)}}]]};
    // Reconstruct a minimal notice even if an older queued payload contains
    // customer-supplied product titles. Receipt identity remains unchanged.
    const lines=data.message.split('\n'),message=['Новая заявка '+data.orderNumber];
    if(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2} \(Asia\/Yekaterinburg\)$/.test(lines[1]||''))message.push(lines[1]);
    const types=['Товары из корзины','Подбор подарка','Большой букет','Корпоративные подарки','Вопрос','Предзаказ','Обращение','Ранее сохранённая заявка'];
    if(types.includes(lines[2]))message.push(lines[2]);
    message.push('Контакты и подробности доступны после входа в панель магазина.');
    const messageId = await send({peer_id:data.recipientId,random_id:data.randomId,message:message.join('\n'),
      keyboard:JSON.stringify(keyboard),dont_parse_links:1,disable_mentions:1});
    if (!Number.isInteger(messageId) || messageId<=0) throw Error('VK_UNCONFIRMED');
    // Private receipt contains no contact details or notification text.
    const receipt = {hash,messageId,createdAt:new Date().toISOString()};
    if (timed) receipt.issuedAt = data.issuedAt;
    if (!await write(key,receipt)) throw Error('RECEIPT_NOT_SAVED');
    return {status:200,body:{ok:true,delivered:true,notificationId:data.notificationId,randomId:data.randomId,messageId}};
  } catch {
    // Never log request body, token, raw VK error or customer information.
    return {status:503,body:{ok:false,code:'RELAY_TEMPORARY_FAILURE'}};
  }
}
module.exports = {authorized, valid, deliver};
