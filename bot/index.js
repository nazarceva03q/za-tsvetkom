const webhook = require('./src/vkWebhook');
const relay = require('./src/siteRelay');
const config = require('./src/config');
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function json(statusCode, data) { return { statusCode, headers, body: JSON.stringify(data) }; }
async function execute(event) {
  try {
    const method = event.httpMethod || 'POST';
    if (method === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    if (method === 'GET') return json(200, { ok: true, service: 'za-tsvetkom-vk-bot' });
    if (method !== 'POST') return json(405, { ok: false });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
    if (Buffer.byteLength(raw,'utf8') > 262144) return json(413,{ok:false});
    let data;
    try { data = JSON.parse(raw); }
    catch { return json(400, { ok: false, error: 'invalid JSON' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, { ok: false });
    if (data.type === 'site.lead.saved') {
      if (!relay.authorized(event.headers, config.siteRelaySecret)) return json(403,{ok:false});
      const result = await relay.deliver(data);
      return json(result.status,result.body);
    }
    if (data.type) {
      const result = await webhook.handle(data);
      return { statusCode: result.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: result.body };
    }
    // Browser requests must be persisted on REG.RU; legacy public lead handler is closed.
    if ('phone' in data) return json(410,{ok:false,error:'Use the website request form'});
    return json(400, { ok: false, error: 'invalid payload or phone' });
  } catch (error) {
    console.error('[handler] Request processing failed');
    return json(500, { ok: false });
  }
};

let queue = Promise.resolve();
module.exports.handler = function(event) {
  const result = queue.then(() => execute(event));
  queue = result.catch(() => {});
  return result;
};
