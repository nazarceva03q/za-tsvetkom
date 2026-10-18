// Разовый скрипт: копирует уже существующие товары сайта (products-data.js,
// daily-bouquets.js, balloons-data.js — window.FLOWER_PRODUCTS,
// window.DAILY_BOUQUETS, window.BALLOON_BOUQUETS, window.BUSINESS_BALLOONS)
// в catalog.json в ПУБЛИЧНОМ бакете Yandex Object Storage — после этого их
// можно менять через бота («Изменить товар» / «Удалить товар»), а не
// только правкой кода сайта.
//
// Фото НЕ перезаливаются — пути к ним оставлены как в исходных данных
// (относительные, например "assets/products/ecuador-101-1.jpg"), сайт и
// так отдаёт их сам по своему текущему адресу; это работает независимо от
// того, на каком домене окажется сайт позже. Только НОВЫЕ фото, которые
// владелица пришлёт через бота при добавлении/изменении товара, реально
// загружаются в Object Storage (см. bot/src/admin.js).
//
// Запуск (один раз, из bot/, с заполненным .env — см. bot/README.md):
//   cd bot
//   node scripts/migrate-products.js
//
// Безопасно запускать повторно — полностью перезаписывает catalog.json
// исходными данными сайта. ВАЖНО: не запускайте это ПОСЛЕ того, как через
// бота уже добавили/изменили/удалили какие-то товары — миграция вернёт
// исходные данные поверх изменений. Она нужна только один раз, для самого
// первого переноса.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('../src/config');
const objectStorage = require('../src/objectStorage');
const products = require('../src/products');

const SITE_DIR = path.join(__dirname, '..', '..');

function loadWindowScript(filename) {
  const code = fs.readFileSync(path.join(SITE_DIR, filename), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename });
  return sandbox.window;
}

async function main() {
  if (!config.s3Public.bucket || !config.s3Public.accessKey || !config.s3Public.secretKey) {
    console.error(
      'YC_PUBLIC_S3_BUCKET / YC_S3_ACCESS_KEY / YC_S3_SECRET_KEY не заполнены в bot/.env — ' +
        'сначала создайте публичный бакет и впишите значения, см. bot/README.md.'
    );
    process.exit(1);
  }

  const catalog = {};
  products.CATEGORY_NAMES.forEach((name) => { catalog[name] = []; });

  const productsWindow = loadWindowScript('products-data.js');
  const dailyWindow = loadWindowScript('daily-bouquets.js');
  const balloonsWindow = loadWindowScript('balloons-data.js');

  let migrated = 0;

  (productsWindow.FLOWER_PRODUCTS || []).forEach((p) => {
    if (!catalog[p.category]) catalog[p.category] = [];
    catalog[p.category].push(Object.assign({}, p, { isHit: false }));
    migrated += 1;
  });

  (dailyWindow.DAILY_BOUQUETS || []).filter((p) => !p.placeholder).forEach((p) => {
    catalog[p.category] = catalog[p.category] || [];
    catalog[p.category].push(Object.assign({}, p, { isHit: false }));
    migrated += 1;
  });

  (balloonsWindow.BALLOON_BOUQUETS || []).forEach((p) => {
    catalog[p.category] = catalog[p.category] || [];
    catalog[p.category].push(Object.assign({}, p, { isHit: false }));
    migrated += 1;
  });

  (balloonsWindow.BUSINESS_BALLOONS || []).forEach((p) => {
    catalog[p.category] = catalog[p.category] || [];
    catalog[p.category].push(Object.assign({}, p, { isHit: false }));
    migrated += 1;
  });

  if (!(await objectStorage.putJson(config.s3Public, 'catalog.json', catalog))) throw new Error('Не удалось записать каталог');

  console.log('Готово: перенесено товаров — ' + migrated + '.');
  console.log('Проверить файл: ' + objectStorage.publicUrl(config.s3Public, 'catalog.json'));
  console.log('Дальше: настройте CORS (node scripts/configure-cors.js) и подключите сайт к этому catalog.json.');
}

main().catch((e) => {
  console.error('Ошибка миграции:', e);
  process.exit(1);
});
