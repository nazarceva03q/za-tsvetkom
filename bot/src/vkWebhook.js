// Authenticate Callback API before normalizing events for the domain logic.
const config = require('./config');
const bot = require('./bot');
const store = require('./store');
const vkApi = require('./vkApi');
function command(payload) {
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return null; } }
  return payload && typeof payload.command === 'string' ? payload.command : null;
}
function normalize(data) {
  const object = data.object || {};
  if (data.type === 'message_event') {
    if (!Number.isInteger(object.user_id) || object.user_id <= 0 || object.peer_id !== object.user_id) return null;
    const payload = command(object.payload);
    if (!payload) return null;
    return { update_type: 'message_callback', user_id: object.user_id, callback_data: payload, callback: { callback_id: data.event_id || object.event_id }, timestamp: data.event_id };
  }
  if (data.type !== 'message_new') return null;
  const message = object.message;
  if (!message || message.out || !Number.isInteger(message.from_id) || message.from_id <= 0 || message.peer_id !== message.from_id) return null;
  const payload = command(message.payload);
  const attachments = (message.attachments || []).filter(a => a.type === 'photo').map(a => {
    const sizes = (a.photo?.sizes || []).filter(s => typeof s.url === 'string').sort((a,b) => b.width*b.height-a.width*a.height);
    return { type: 'image', payload: { url: sizes[0]?.url } };
  });
  return { update_type: payload ? 'message_callback' : 'message_created', user_id: message.from_id, callback_data: payload,
    callback: payload ? { callback_id: data.event_id || message.id } : undefined,
    timestamp: message.date, message: { sender: { user_id: message.from_id }, body: { mid: data.event_id || message.id || message.conversation_message_id, text: message.text || '', attachments } } };
}
async function handle(data) {
  if (!config.groupId || !config.webhookSecret) return { status: 503, body: 'VK callback is not configured' };
  if (String(data.group_id) !== String(config.groupId) || data.secret !== config.webhookSecret) return { status: 403, body: 'Forbidden' };
  if (data.type === 'confirmation') return config.confirmationToken ? { status: 200, body: config.confirmationToken } : { status: 503, body: 'VK_CONFIRMATION_TOKEN is not configured' };
  const update = normalize(data);
  if (update && !config.adminChatIds.some(id => String(id) === String(update.user_id))) return {status:200,body:'ok'};
  if (update) {
    if (data.type === 'message_event') {
      try { await vkApi.answerEvent(data.object); } catch (error) { console.warn('[vkWebhook] Callback acknowledgement failed:', error.message); }
    }
    const eventId = data.group_id + ':' + data.type + ':' + (data.event_id || (data.type === 'message_event' ? data.object.event_id : data.object.message.id || data.object.message.conversation_message_id));
    if (await store.hasProcessedEvent(eventId)) return { status: 200, body: 'ok' };
    await bot.handleUpdate(update);
    await store.markProcessedEvent(eventId);
  }
  return { status: 200, body: 'ok' };
}
module.exports = { handle, normalize };
