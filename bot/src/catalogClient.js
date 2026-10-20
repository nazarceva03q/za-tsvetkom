'use strict';
// The public catalogue and product photos live on REG.RU. Private bot sessions
// still use Object Storage. Never fall back to a second writable catalogue.
const crypto = require('node:crypto');
const config = require('./config');
function endpoint() {
  const url = new URL(config.regCatalogUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('Configure an HTTPS REG catalogue URL');
  return url;
}
async function request(method, body, headers = {}, photo = false) {
  const url = endpoint();
  if (photo) url.searchParams.set('action', 'photo');
  if (method !== 'GET') {
    if (!/^[a-f0-9]{64}$/i.test(config.regCatalogSecret || '')) throw Error('REG catalogue secret missing');
    headers.Authorization = 'Bearer ' + config.regCatalogSecret;
    headers['X-ZT-Catalog-Key'] = config.regCatalogSecret;
  }
  const response = await fetch(url, {method, body, headers, redirect:'error', signal:AbortSignal.timeout(20000)});
  if (!response.ok) {
    const error = Error('REG catalogue request failed: ' + response.status);
    error.status = response.status;
    throw error;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw Error('Catalogue response too large');
  return {data:JSON.parse(Buffer.from(bytes).toString('utf8')), etag:response.headers.get('x-catalog-version') || response.headers.get('etag')};
}
async function getJsonWithVersion() {
  const result = await request('GET');
  if (!/^"[a-f0-9]{64}"$/.test(result.etag || '')) throw Error('Catalogue revision missing');
  return result;
}
async function putJsonIfVersion(_cfg, _key, catalog, etag) {
  if (!/^"[a-f0-9]{64}"$/.test(etag || '')) throw Error('Catalogue revision missing');
  const body = JSON.stringify(catalog);
  const key = crypto.createHash('sha256').update(etag + '\n' + body).digest('hex');
  const result = await request('PUT', body, {'Content-Type':'application/json','If-Match':etag,'Idempotency-Key':key});
  if (result.data.ok !== true) throw Error('Catalogue save not confirmed');
  return true;
}
async function uploadPhoto(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 15 * 1024 * 1024) throw Error('Photo too large');
  const result = await request('POST', buffer, {'Content-Type':contentType || 'image/jpeg'}, true);
  if (result.data.ok !== true) throw Error('Photo save not confirmed');
  const url = new URL(result.data.url, endpoint());
  if (url.origin !== endpoint().origin || !url.pathname.startsWith('/assets/catalog/')) throw Error('Unexpected photo URL');
  return url.href;
}
module.exports = {getJsonWithVersion, putJsonIfVersion, uploadPhoto};
