// VK API transport. Node.js 22+, no external packages.
const crypto = require('crypto');
const config = require('./config');

async function callApi(method, params = {}) {
  if (!config.botToken) throw new Error('VK_GROUP_TOKEN не настроен');
  const body = new URLSearchParams({ ...params, access_token: config.botToken, v: config.apiVersion });
  const response = await fetch('https://api.vk.com/method/' + method, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('VK HTTP ' + response.status);
  const json = await response.json();
  if (json.error) throw new Error('VK API ' + json.error.error_code + ': ' + json.error.error_msg);
  return json.response;
}

function callbackButton(text, payload) {
  return { action: { type: 'callback', label: [...text].slice(0, 40).join(''), payload: JSON.stringify({ command: payload }) }, color: 'secondary' };
}
function linkButton(text, link) { return { action: { type: 'open_link', label: text, link } }; }
// VK inline keyboards support at most 6 rows and 10 buttons. Split large menus across messages.
function keyboardPages(rows) {
  const pages = []; let page = [], count = 0;
  for (const row of rows || []) {
    for (let i = 0; i < row.length; i += 5) {
      const buttons = row.slice(i, i + 5);
      if (page.length === 6 || count + buttons.length > 10) { pages.push(page); page = []; count = 0; }
      page.push(buttons); count += buttons.length;
    }
  }
  if (page.length) pages.push(page);
  return pages;
}
async function sendMessage(target, text, rows, attachment) {
  const peer_id = target.userId || target.chatId;
  const pages = keyboardPages(rows);
  const chars = Array.from(String(text || ' ')), chunks = [];
  while (chars.length) chunks.push(chars.splice(0, 3500).join(''));
  if (!chunks.length) chunks.push(' ');
  for (let i = 0; i < chunks.length; i++) {
    const params = { peer_id, message: chunks[i], random_id: crypto.randomInt(1, 2147483647) };
    if (i === chunks.length - 1) {
      if (pages.length) params.keyboard = JSON.stringify({ inline: true, buttons: pages[0] });
      if (attachment) params.attachment = attachment;
    }
    await callApi('messages.send', params);
  }
  for (const buttons of pages.slice(1)) await callApi('messages.send', { peer_id, message: 'Продолжение меню:', random_id: crypto.randomInt(1, 2147483647), keyboard: JSON.stringify({ inline: true, buttons }) });
  return { ok: true };
}
async function downloadBinary(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Фото должно иметь HTTPS-адрес');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Photo HTTP ' + response.status);
  const contentType = (response.headers.get('content-type') || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Неподдерживаемый формат фото');
  const chunks=[];let length=0;
  for await (const chunk of response.body) { length+=chunk.length;if(length>20*1024*1024)throw new Error('Фото больше 20 МБ');chunks.push(Buffer.from(chunk)); }
  return { buffer: Buffer.concat(chunks), contentType };
}
async function sendPhotoUrlMessage(target, text, rows, photoUrl) {
  let attachment;
  try {
    const absolute = new URL(photoUrl, config.siteBaseUrl + '/').href;
    const { buffer, contentType } = await downloadBinary(absolute);
    const upload = await callApi('photos.getMessagesUploadServer', { peer_id: target.userId || target.chatId });
    const form = new FormData();
    form.append('photo', new Blob([buffer], { type: contentType }), contentType === 'image/png' ? 'photo.png' : 'photo.jpg');
    const response = await fetch(upload.upload_url, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('VK photo upload HTTP ' + response.status);
    const data = await response.json();
    const photos = await callApi('photos.saveMessagesPhoto', { server: data.server, photo: data.photo, hash: data.hash });
    if (!photos?.[0]) throw new Error('VK did not save photo');
    const p = photos[0]; attachment = 'photo' + p.owner_id + '_' + p.id + (p.access_key ? '_' + p.access_key : '');
  } catch (error) {
    console.warn('[vkApi] Не удалось прикрепить фото:', error.message);
    return { ok: false };
  }
  return sendMessage(target, text, rows, attachment);
}
function userMention(label, id) { return '[id' + id + '|' + String(label).replace(/[\[\]|]/g, '') + ']'; }
async function answerEvent(event) {
  await callApi('messages.sendMessageEventAnswer', { event_id: event.event_id, user_id: event.user_id, peer_id: event.peer_id });
}
module.exports = { callApi, callbackButton, linkButton, keyboardPages, sendMessage, sendPhotoUrlMessage, downloadBinary, userMention, sendMarkdownMessage: sendMessage, answerEvent };
