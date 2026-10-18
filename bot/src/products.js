// Динамический каталог товаров сайта «За цветком» — управляется из бота
// Max (владелица): добавление/изменение/удаление товаров, управление
// количеством, отметка «Хит». Хранится ОДНИМ JSON-файлом catalog.json в
// ПУБЛИЧНОМ бакете Yandex Object Storage — сайт читает его напрямую по
// обычной HTTPS-ссылке (см. bot/README.md).
//
// Форма данных для обычных категорий совпадает с window.FLOWER_PRODUCTS /
// window.BALLOON_BOUQUETS на сайте (products-data.js, balloons-data.js):
//   { id, slug, name, price (число, без ₽), category, description
//     (пункты состава + необязательная "высота ..." через " · "),
//     note, stock (число или null — «под заказ»/не отслеживается),
//     tags, badge, images (массив URL), madeToOrder, isHit }
// Категория «Для бизнеса» — отдельная форма (см. window.BUSINESS_BALLOONS):
//   { id, slug, name, business: true, perStand, description, note,
//     price, maxPrice (min/max по фото), images, photoPrices (цена
//     каждого фото — «Оформление на фото: ...» показывается по фото),
//     category: 'Для бизнеса', tags, stock: null, isHit }
//
// Категории и их порядок — как в самом сайте (app.js: categories +
// balloonCategories). «Хит»: товар, отмеченный при добавлении/изменении,
// кладётся В НАЧАЛО массива своей категории (самый верх галереи на
// сайте) — см. saveProduct ниже.

const crypto = require('crypto');
const config = require('./config');
const objectStorage = require('./objectStorage');

const CATALOG_KEY = 'catalog.json';

const FLOWER_CATEGORIES = ['Букет дня', 'Розы', 'Сборные букеты', 'Монобукеты', 'Композиции', 'Свадебные букеты'];
const BALLOON_CATEGORIES = [
  'Букеты из шаров', 'Для девушек', '14 февраля', 'Девичник', 'Новый год',
  'Последний звонок', 'Для девочек', 'Для мальчиков', 'Гендер пати',
  'Коробка с шарами', 'Годовасия', 'Для мужчин'
];
const BUSINESS_CATEGORY = 'Для бизнеса';

const CATEGORY_NAMES = [...FLOWER_CATEGORIES, ...BALLOON_CATEGORIES, BUSINESS_CATEGORY];

// Фиксированные тексты — те же, что уже используются в данных сайта
// (balloons-data.js), символ в символ, чтобы новые товары не отличались
// от существующих.
const BALLOON_ORDER_NOTE =
  'Товар под заказ. Цвет уточняйте по наличию. Надписи можно любые. Упаковка – по наличию; по вашему желанию её можно заменить на другую';
const BUSINESS_NOTE = 'Метраж рассчитывается индивидуально для каждого заказчика. Цена зависит от объёма работы.';

function isBusinessCategory(category) {
  return category === BUSINESS_CATEGORY;
}
function isBalloonCategory(category) {
  return BALLOON_CATEGORIES.includes(category);
}

function emptyCatalog() {
  const catalog = {};
  CATEGORY_NAMES.forEach((name) => { catalog[name] = []; });
  return catalog;
}

async function getCatalog() {
  const data = await objectStorage.getJson(config.s3Public, CATALOG_KEY, null);
  const catalog = emptyCatalog();
  if (data && typeof data === 'object') {
    CATEGORY_NAMES.forEach((name) => { if (Array.isArray(data[name])) catalog[name] = data[name]; });
  }
  return catalog;
}

async function saveCatalog(catalog) {
  CATEGORY_NAMES.forEach((name) => catalog[name].sort((a, b) => Number(Boolean(b.isHit)) - Number(Boolean(a.isHit))));
  if (!(await objectStorage.putJson(config.s3Public, CATALOG_KEY, catalog))) throw new Error('Не удалось записать каталог в Object Storage');
  return true;
}

// – транслитерация для id/slug нового товара (та же схема, что уже
// используется в id существующих товаров сайта) –
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

function slugify(text) {
  const transliterated = String(text)
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('');
  const slug = transliterated.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'tovar';
}

function idPrefix(category) {
  if (isBusinessCategory(category)) return 'business-';
  if (isBalloonCategory(category)) return 'balloon-';
  return 'product-';
}

function allIds(catalog) {
  const ids = new Set();
  CATEGORY_NAMES.forEach((name) => catalog[name].forEach((p) => ids.add(p.id)));
  return ids;
}

function generateId(catalog, name, category) {
  const base = idPrefix(category) + slugify(name);
  const ids = allIds(catalog);
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(base + '-' + n)) n += 1;
  return base + '-' + n;
}

function findById(catalog, id) {
  for (const name of CATEGORY_NAMES) {
    const item = catalog[name].find((p) => p.id === id);
    if (item) return { category: name, product: item };
  }
  return null;
}

async function getProductById(id) {
  if (!id) return null;
  const catalog = await getCatalog();
  const found = findById(catalog, id);
  return found ? found.product : null;
}

// Создаёт товар (id === null) ИЛИ полностью заменяет существующий по id —
// в том числе переносит его в другую категорию, если она изменилась.
// fields для обычных категорий: { name, price (число), composition
// (массив строк), extraInfo (строка "высота ..." либо произвольный текст,
// либо '' — см. products.js шапка про description/note), stock (число
// или null), photos (массив URL), isHit }.
// fields для «Для бизнеса»: { name, photos (массив URL), photoPrices
// (массив чисел, по одному на фото), description (необязательно), perStand
// (необязательно), isHit }.
async function saveProduct(category, id, fields) {
  if (!CATEGORY_NAMES.includes(category)) throw new Error('Неизвестная категория: ' + category);
  const catalog = await getCatalog();

  let existing = null;
  if (id) {
    CATEGORY_NAMES.forEach((name) => {
      const idx = catalog[name].findIndex((p) => p.id === id);
      if (idx !== -1) {
        existing = catalog[name][idx];
        catalog[name].splice(idx, 1);
      }
    });
  }

  const finalId = id || generateId(catalog, fields.name, category);
  const isHit = Boolean(fields.isHit);
  let product;

  if (isBusinessCategory(category)) {
    const photoPrices = (fields.photoPrices || []).map(Number);
    product = Object.assign({}, existing, {
      id: finalId,
      slug: finalId,
      name: fields.name,
      business: true,
      perStand: Boolean(fields.perStand !== undefined ? fields.perStand : existing && existing.perStand),
      description: fields.description || '',
      note: BUSINESS_NOTE,
      price: Math.min(...photoPrices),
      maxPrice: Math.max(...photoPrices),
      images: fields.photos || [],
      photoPrices,
      category,
      tags: 'шары оформление для бизнеса',
      stock: null,
      isHit
    });
  } else {
    const composition = Array.isArray(fields.composition) ? fields.composition : [];
    const descParts = composition.slice();
    let note = '';
    const extra = (fields.extraInfo || '').trim();
    if (extra) {
      if (/^высота/i.test(extra)) descParts.push(extra);
      else note = extra;
    }
    const madeToOrder = isBalloonCategory(category) && fields.stock === null;
    product = Object.assign({}, existing, {
      id: finalId,
      slug: finalId,
      name: fields.name,
      price: Number(fields.price),
      category,
      description: descParts.join(' · '),
      note: madeToOrder ? BALLOON_ORDER_NOTE : note,
      stock: fields.stock === null ? null : Number(fields.stock),
      tags: (descParts.join(' ') + ' ' + category).toLowerCase(),
      badge: (existing && existing.badge) || '',
      images: fields.photos || [],
      madeToOrder,
      isHit
    });
  }

  if (isHit) catalog[category].unshift(product);
  else catalog[category].push(product);

  await saveCatalog(catalog);
  return product;
}

async function deleteProductById(id) {
  const catalog = await getCatalog();
  let found = false;
  CATEGORY_NAMES.forEach((name) => {
    const idx = catalog[name].findIndex((p) => p.id === id);
    if (idx !== -1) {
      catalog[name].splice(idx, 1);
      found = true;
    }
  });
  if (found) await saveCatalog(catalog);
  return found;
}

// Только количество (для «Управление количеством» в меню) — без похода
// через полный экран редактирования товара.
async function updateHit(id, isHit) {
  const catalog = await getCatalog();
  const found = findById(catalog, id);
  if (!found) return null;
  found.product.isHit = Boolean(isHit);
  await saveCatalog(catalog);
  return found.product;
}

async function updateStock(id, newStock) {
  const catalog = await getCatalog();
  const found = findById(catalog, id);
  if (!found) return null;
  const { category, product } = found;
  product.stock = newStock;
  if (isBalloonCategory(category) && !isBusinessCategory(category)) {
    product.madeToOrder = newStock === null;
    if (newStock === null) product.note = BALLOON_ORDER_NOTE;
    else if (product.note === BALLOON_ORDER_NOTE) product.note = '';
  }
  await saveCatalog(catalog);
  return product;
}

// – нечёткий поиск по названию, для «Изменить»/«Удалить»/«Управление
// количеством» – владелица может написать название неточно –
function normalizeForSearch(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function wordsMatch(a, b) {
  if (!a || !b) return false;
  if (a.length < 3 || b.length < 3) return a === b;
  const minShare = Math.min(4, a.length, b.length);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared >= minShare;
}

async function searchByName(query, limit) {
  const catalog = await getCatalog();
  const q = normalizeForSearch(query);
  const qWords = q.split(' ').filter(Boolean);
  const results = [];

  CATEGORY_NAMES.forEach((category) => {
    catalog[category].forEach((product) => {
      const name = normalizeForSearch(product.name);
      let score = 0;
      if (name === q) score = 100;
      else if (q && name.indexOf(q) !== -1) score = 80;
      else {
        const nameWords = name.split(' ').filter(Boolean);
        qWords.forEach((w) => {
          if (nameWords.some((nw) => wordsMatch(nw, w))) score += 20;
        });
      }
      if (score > 0) results.push({ category, product, score });
    });
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit || 5);
}

// Загружает фото товара (байты, полученные из чата Max) в публичный
// бакет и возвращает его постоянную HTTPS-ссылку, либо null, если
// загрузка не удалась.
async function uploadPhoto(buffer, contentType) {
  const ext = contentType && contentType.indexOf('png') !== -1 ? 'png' : contentType && contentType.indexOf('webp') !== -1 ? 'webp' : 'jpg';
  const key = 'products/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  const ok = await objectStorage.putObject(config.s3Public, key, buffer, contentType || 'image/jpeg');
  if (!ok) return null;
  return objectStorage.publicUrl(config.s3Public, key);
}

module.exports = {
  FLOWER_CATEGORIES,
  BALLOON_CATEGORIES,
  BUSINESS_CATEGORY,
  BUSINESS_NOTE,
  BALLOON_ORDER_NOTE,
  CATEGORY_NAMES,
  isBusinessCategory,
  isBalloonCategory,
  getCatalog,
  saveProduct,
  deleteProductById,
  updateStock,
  updateHit,
  getProductById,
  searchByName,
  uploadPhoto
};
