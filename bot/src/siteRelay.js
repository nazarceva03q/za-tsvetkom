// Only authenticated notifications of requests ALREADY saved on REG.RU.
// Catalogue, photos and administrative storage keep their existing Yandex path.
const crypto = require('crypto');
const config = require('./config');
const storage = require('./objectStorage');
const vk = require('./vkApi');
function authorized(headers, secret) {
  const values = Object.entries(headers || {}).filter(([key]) => key.toLowerCase() === 'x-relay-key');
  if (!/^[a-f0-9]{64,128}$/.test(secret || '') || values.length !== 1 || typeof values[0][1] !== 'string') return false;
  const actual = Buffer.from(values[0][1]), expected = Buffer.from(secret);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function valid(data) {
  return data && !Array.isArray(data) &&
    Object.keys(data).sort().join(',') === 'message,notificationId,orderNumber,randomId,recipientId,type' &&
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
  if (!cfg.ownerChatId || data.recipientId !== String(cfg.ownerChatId))
    return {status:409,body:{ok:false,code:'OWNER_MISMATCH'}};
  if (!cfg.s3?.bucket || !cfg.s3.accessKey || !cfg.s3.secretKey || !cfg.botToken)
    return {status:503,body:{ok:false,code:'RELAY_NOT_CONFIGURED'}};
  const read = deps.read || ((key) => storage.getJson(cfg.s3,key,null));
  const write = deps.write || ((key,value) => storage.putJson(cfg.s3,key,value));
  const send = deps.send || ((params) => vk.callApi('messages.send', params));
  const key = 'site_notifications/' + crypto.createHash('sha256').update(data.orderNumber+':'+data.notificationId).digest('hex')+'.json';
  const hash = crypto.createHash('sha256').update(JSON.stringify([data.type,data.notificationId,data.orderNumber,data.recipientId,data.randomId,data.message])).digest('hex');
  try {
    const previous = await read(key);
    if (previous) {
      if (previous.hash !== hash) return {status:409,body:{ok:false,code:'RELAY_CONFLICT'}};
      if (!Number.isInteger(previous.messageId) || previous.messageId<=0) throw Error('INVALID_RECEIPT');
      return {status:200,body:{ok:true,delivered:true,notificationId:data.notificationId,randomId:data.randomId,messageId:previous.messageId}};
    }
    // A lost response or concurrent function invocation reuses the SAME VK random_id.
    const messageId = await send({peer_id:data.recipientId,random_id:data.randomId,message:data.message,dont_parse_links:1,disable_mentions:1});
    if (!Number.isInteger(messageId) || messageId<=0) throw Error('VK_UNCONFIRMED');
    // Private receipt contains no contact details or notification text.
    if (!await write(key,{hash,messageId,createdAt:new Date().toISOString()})) throw Error('RECEIPT_NOT_SAVED');
    return {status:200,body:{ok:true,delivered:true,notificationId:data.notificationId,randomId:data.randomId,messageId}};
  } catch {
    // Never log request body, token, raw VK error or customer information.
    return {status:503,body:{ok:false,code:'RELAY_TEMPORARY_FAILURE'}};
  }
}
module.exports = {authorized, valid, deliver};
