// Shared REG.RU catalogue; private bot sessions remain in Yandex.
const pricing = require('./price');
const objectStorage = require('./catalogClient');

const CATALOG_KEY = 'catalog.json';
const CATALOG_VERSION = Symbol('catalogVersion');

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
  const {data,etag} = await objectStorage.getJsonWithVersion(null, CATALOG_KEY, null);
  if (!data || Array.isArray(data) || typeof data!=='object' || !CATEGORY_NAMES.every(name=>Array.isArray(data[name])))
    throw new Error('Каталог отсутствует или повреждён. Сначала подготовьте полный каталог сайта; пустой каталог автоматически не создаётся.');
  const catalog = emptyCatalog(), ids=new Set();
  CATEGORY_NAMES.forEach(name=>{
    catalog[name]=data[name];
    for(const p of catalog[name]){
      if(!p || typeof p.id!=='string' || !/^[a-z0-9-]{1,100}$/.test(p.id) || ids.has(p.id) ||
        p.category!==name || typeof p.name!=='string' || !Array.isArray(p.images) ||
        (p.price===null?!p.priceLabel:(!Number.isFinite(p.price) || p.price<=0)) || (p.stock!==null && (!Number.isInteger(p.stock)||p.stock<0||p.stock>10000)))
        throw new Error('Invalid product in stored catalog');
      ids.add(p.id);
    }
  });
  Object.defineProperty(catalog,CATALOG_VERSION,{value:etag});
  return catalog;
}

async function saveCatalog(catalog) {
  CATEGORY_NAMES.forEach((name) => catalog[name].sort((a, b) => Number(Boolean(b.isHit)) - Number(Boolean(a.isHit))));
  if (!catalog[CATALOG_VERSION]) throw new Error('Catalog version missing');
  if (!(await objectStorage.putJsonIfVersion(null, CATALOG_KEY, catalog,catalog[CATALOG_VERSION]))) throw new Error('Не удалось сохранить каталог на REG.RU');
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

  if (id && !existing) throw new Error('Товар уже удалён. Найдите товар заново.');
  const finalId = id || generateId(catalog, fields.name, category);
  const isHit = Boolean(fields.isHit);
  let product;

  if (isBusinessCategory(category)) {
    const photoPrices = (fields.photoPrices || []).map(p=>p===null?null:Number(p));
    const photoPriceLabels=(fields.photoPriceLabels||[]).slice();
    const summary=pricing.business(photoPrices,photoPriceLabels);
    product = Object.assign({}, existing, {
      id: finalId,
      slug: finalId,
      name: fields.name,
      business: true,
      perStand: Boolean(fields.perStand !== undefined ? fields.perStand : existing && existing.perStand),
      description: fields.description || '',
      note: BUSINESS_NOTE,
      price: summary.price,
      maxPrice: summary.maxPrice,
      priceLabel:summary.priceLabel,
      images: fields.photos || [],
      photoPrices,
      photoPriceLabels,
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
      price: fields.price===null?null:Number(fields.price),
      priceLabel:fields.priceLabel||'',
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
  if(newStock!==null&&(!Number.isInteger(newStock)||newStock<0||newStock>10000)) throw new Error('Invalid stock');
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

function wordStem(word) {
  if (!/^[а-я]+$/.test(word) || word.length < 4) return word;
  const stem = word.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|иях|ах|ях|ых|их|ов|ев|ей|ой|ый|ий|ая|яя|ое|ее|ые|ие|ую|юю|ия|ии|а|я|ы|и|у|ю|е|о)$/,'');
  return stem.length >= 3 ? stem : word;
}

function wordsMatch(a, b) {
  if (!a || !b) return false;
  const x = wordStem(a), y = wordStem(b);
  return x === y || (Math.min(x.length,y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
}

async function searchByName(query, limit) {
  const catalog = await getCatalog();
  const q = normalizeForSearch(query);
  const stopWords = new Set(['из','для','и','с','со','в','на','по','к']);
  const qWords = Array.from(new Set(q.split(' ').filter(w=>w && !stopWords.has(w))));
  const results = [];

  CATEGORY_NAMES.forEach((category) => {
    catalog[category].forEach((product) => {
      const name = normalizeForSearch(product.name);
      let score = 0;
      if (name === q) score = 100;
      else if (q && name.indexOf(q) !== -1) score = 80;
      else {
        const nameWords = name.split(' ').filter(Boolean);
        const matches = qWords.filter(w=>nameWords.some(nw=>wordsMatch(nw,w))).length;
        // A shared generic word must not pull unrelated products into results.
        if (qWords.length && matches === qWords.length) score = 60 + matches;
      }
      if (score > 0) results.push({ category, product, score });
    });
  });

  results.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name,'ru'));
  return results.slice(0, limit || 5);
}

// Upload to REG.RU before publishing the product. Failure prevents publication.
async function uploadPhoto(buffer, contentType) {
  return objectStorage.uploadPhoto(buffer, contentType);
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
