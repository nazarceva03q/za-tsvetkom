// Единая точка формирования и отправки карточки заявки владелице —
// используется и ботом (переписка с покупателем), и вебхуком с сайта
// (форма заказа), чтобы логика проверки повторного клиента и текст
// карточки не дублировались.

const config = require('./config');
const store = require('./store');
const vkApi = require('./vkApi');
const products = require('./products');

function normalizePhone(rawPhone) {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits[0] !== '7') digits = '7' + digits;
  return digits;
}

function formatPhone(digits) {
  if (digits.length !== 11) return digits;
  return '+7 (' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7, 9) + '-' + digits.slice(9, 11);
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

function money(n) {
  try { return new Intl.NumberFormat('ru-RU').format(n); } catch (e) { return String(n); }
}

function productPriceText(product) {
  if (!product) return '';
  if (product.business) {
    const prices = product.photoPrices || [];
    if (prices.length && Math.min(...prices) !== Math.max(...prices)) {
      return money(Math.min(...prices)) + '–' + money(Math.max(...prices)) + ' ₽';
    }
  }
  return money(product.price) + ' ₽';
}

// data: { source, name, phone, productId, productName, siteRef, imageUrl,
// comment } — всё, кроме source/phone, необязательно. product — результат
// products.getProductById (необязателен – buildCard сам его найдёт, если
// не передан; так функция остаётся удобной для тестов).
async function buildCard(data, repeatInfo, product) {
  const lines = ['🔔 НОВАЯ ЗАЯВКА'];
  lines.push('Источник: ' + (data.source || 'Общая заявка'));
  if (data.name) lines.push('Имя: ' + data.name);
  lines.push('Телефон: ' + formatPhone(normalizePhone(data.phone)));
  if (data.productName) lines.push('Товар: ' + data.productName);
  const resolvedProduct = product !== undefined ? product : (data.productId ? await products.getProductById(data.productId) : null);
  if (resolvedProduct) lines.push('Цена: ' + productPriceText(resolvedProduct));
  if (data.siteRef) lines.push('🔗 Ссылка на сайте: ' + data.siteRef);
  if (data.comment) lines.push('Комментарий: ' + data.comment);
  if (data.phone) {
    lines.push(
      repeatInfo && repeatInfo.isRepeat
        ? '👤 Повторный заказ (первое обращение: ' + formatDate(repeatInfo.firstSeen) + ')'
        : '🆕 Первый заказ'
    );
  }
  lines.push('Время: ' + formatDate(new Date().toISOString()));
  return lines.join('\n\n');
}

async function sendLeadNotification(data) {
  const phoneDigits = normalizePhone(data.phone);
  if (!/^7\d{10}$/.test(phoneDigits)) throw new Error('Некорректный номер телефона');
  const repeatInfo = data.phone ? await store.checkAndRecordCustomer(phoneDigits) : { isRepeat: false, firstSeen: null };

  const product = data.productId ? await products.getProductById(data.productId) : null;
  const text = await buildCard(data, repeatInfo, product);
  const photoUrl = product ? (product.images || [])[0] : null;

  await store.saveLead({
    kind: 'order',
    source: data.source || 'Общая заявка',
    name: data.name || '',
    phone: formatPhone(phoneDigits),
    productName: data.productName || '',
    siteRef: data.siteRef || '',
    isRepeat: Boolean(repeatInfo && repeatInfo.isRepeat)
  });

  if (!config.ownerChatId) {
    console.warn('[notify] VK_OWNER_ID не настроен, карточка не отправлена:\n' + text);
    return { ok: false, text, repeatInfo };
  }

  let result;
  if (photoUrl) {
    result = await vkApi.sendPhotoUrlMessage({ userId: config.ownerChatId }, text, null, photoUrl);
    if (!result.ok) result = await vkApi.sendMessage({ userId: config.ownerChatId }, text);
  } else {
    result = await vkApi.sendMessage({ userId: config.ownerChatId }, text);
  }
  return { ok: result.ok, text, repeatInfo };
}

module.exports = {
  normalizePhone,
  formatPhone,
  buildCard,
  sendLeadNotification
};
