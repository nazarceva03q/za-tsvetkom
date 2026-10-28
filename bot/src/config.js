// Все секреты и адреса — только из переменных окружения (.env локально,
// переменные окружения сервиса на проде). Ничего не хардкодим здесь.
// Своя загрузка .env вместо пакета dotenv – чтобы не тянуть лишнюю
// зависимость ради пяти строк парсинга KEY=VALUE.
const fs = require('fs');
const path = require('path');

(function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
})();

// user_id владелицы (VK_OWNER_ID) — единственный адрес, куда уходят
// заявки/вопросы покупателей. Доступ к МЕНЮ УПРАВЛЕНИЯ (admin.js) может
// быть у нескольких user_id сразу: VK_OWNER_ID всегда в их числе,
// плюс через запятую можно перечислить ещё людей в VK_ADMIN_IDS.
const ownerChatId = process.env.VK_OWNER_ID || '';
const extraAdminIds = (process.env.VK_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const adminChatIds = Array.from(new Set([ownerChatId, ...extraAdminIds].filter(Boolean)));

const config = {
  siteRelaySecret: process.env.SITE_RELAY_SECRET || '',
  siteRelayRequireExpiry: process.env.SITE_RELAY_REQUIRE_EXPIRY === 'true',
  ownerOrdersUrl: process.env.OWNER_ORDERS_URL || 'https://xn----ctbjb9aqim7a5cq.online/owner/orders.php',
  requestsInVkEnabled: process.env.REQUESTS_IN_VK_ENABLED === 'true', // default: protected site panel
  botToken: process.env.VK_GROUP_TOKEN || '',
  groupId: process.env.VK_GROUP_ID || '',
  confirmationToken: process.env.VK_CONFIRMATION_TOKEN || '',
  apiVersion: process.env.VK_API_VERSION || '5.199',
  ownerChatId,
  adminChatIds,
  webhookSecret: process.env.VK_CALLBACK_SECRET || '',
  // Current storefront; no cloud credentials in public links.
  siteBaseUrl: (process.env.SITE_BASE_URL || 'https://xn----ctbjb9aqim7a5cq.online').replace(/\/$/, ''),
  port: parseInt(process.env.PORT, 10) || 3100,
  publicServerUrl: (process.env.PUBLIC_SERVER_URL || '').replace(/\/$/, ''),
  // Yandex Object Storage – постоянное хранилище сессий/клиентов/вопросов/
  // заявок на Cloud Functions (там нет постоянного диска между вызовами).
  // На VM-деплое эти переменные можно не задавать — store.js сам
  // переключается на локальные файлы, если YC_S3_BUCKET пуст (см. store.js).
  s3: {
    bucket: process.env.YC_S3_BUCKET || '',
    accessKey: process.env.YC_S3_ACCESS_KEY || '',
    secretKey: process.env.YC_S3_SECRET_KEY || ''
  },
  regCatalogUrl: process.env.REG_CATALOG_URL || '',
  regInboxUrl: process.env.REG_INBOX_URL || 'https://xn----ctbjb9aqim7a5cq.online/api/v1/bot-inbox.php',
  regInboxSecret: process.env.REG_INBOX_SECRET || '',
  regCatalogSecret: process.env.REG_CATALOG_SECRET || ''
};

if (!config.botToken) {
  console.warn('[config] VK_GROUP_TOKEN не задан — запросы к VK API будут падать. Заполните bot/.env');
}
if (!config.ownerChatId) {
  console.warn('[config] VK_OWNER_ID не задан — уведомления владелице отправляться не будут, пока вы не впишете её user_id в bot/.env (см. README.md)');
}
if (!config.s3.bucket) {
  console.warn('[config] YC_S3_BUCKET не задан — используется локальное файловое хранилище (bot/data/*.json). На Cloud Functions это НЕ будет работать между вызовами, см. README.md.');
}
if (!config.regCatalogUrl) console.warn('[config] REG_CATALOG_URL missing: catalogue editing disabled.');

module.exports = config;
