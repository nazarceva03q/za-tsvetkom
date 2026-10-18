// Ordinary Node.js hosting, no external packages.
const http = require('http');
const config = require('./src/config');
const { handler } = require('./index');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'za-tsvetkom-vk-bot' })); return;
  }
  if (!['/webhook/vk', '/webhook/lead'].includes(pathname)) { res.writeHead(404); res.end('Not found'); return; }
  const chunks = []; let length = 0;
  req.on('data', chunk => { length += chunk.length; if (length <= 1024 * 1024) chunks.push(chunk); });
  req.on('error', () => { if (!res.headersSent) res.writeHead(400); res.end(); });
  req.on('end', async () => {
    if (length > 1024 * 1024) { res.writeHead(413); res.end('Request too large'); return; }
    try {
      const result = await handler({ httpMethod: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(result.statusCode, result.headers); res.end(result.body);
    } catch (error) { res.writeHead(500); res.end('Internal error'); }
  });
});
server.requestTimeout = 120000;
if (require.main === module) server.listen(config.port, () => console.log('VK bot listening on port ' + config.port));
module.exports = server;
