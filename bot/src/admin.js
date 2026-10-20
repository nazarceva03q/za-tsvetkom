// Управление каталогом сайта «За цветком» из чата ВКонтакте — доступно только
// владелице/администраторам (config.adminChatIds, см. bot/src/bot.js —
// isOwner). Сценарии:
//   – меню (Добавить/Изменить/Удалить товар, Управление количеством, Заявки)
//   – добавление товара: категория → фото → название → состав → описание/
//     доп. информация → цена → количество → «Хит?» → предпросмотр с
//     кнопками «Изменить» на каждую строку → «Сохранить»
//   – категория «Для бизнеса» — другой порядок вопросов (см. handleBiz*
//     ниже): фото по одному, с ценой сразу под каждым («Оформление на
//     фото: ...»), фиксированное описание (можно оставить как есть или
//     заменить), «Хит?», предпросмотр. Итоговая цена на карточке (одна
//     цифра или диапазон) считается автоматически по минимальной и
//     максимальной цене фото — как уже работает на сайте для этой
//     категории (см. products.js, saveProduct → business ветка).
//   – изменение/удаление товара — поиск по названию среди уже существующих
//     товаров → «Этот товар» → тот же экран предпросмотра, либо
//     подтверждение удаления
//   – управление количеством — поиск товара → показывает текущий остаток →
//     новое количество (или «-» для «под заказ»)
//   – «Заявки» — заказы с сайта и вопросы из чата, с пагинацией
//   – «Хит»: отмеченный товар кладётся в САМОЕ НАЧАЛО массива своей
//     категории (product.js, saveProduct) — то есть на самый верх галереи
//     на сайте. Снять отметку можно из экрана предпросмотра при изменении
//     товара — тогда бот отдельно спрашивает подтверждение («Убрать товар
//     из Хитов?»), в отличие от простановки отметки, которая ничего не
//     подтверждает лишний раз.
//
// VK transport handles keyboard pagination and photo upload.

const vkApi = require('./vkApi');
const store = require('./store');
const products = require('./products');
const config = require('./config');
const pricing = require('./price');

const REGULAR_FIELD_ORDER = ['photos', 'name', 'composition', 'extra', 'price', 'stock'];

function isAdminStep(step) {
  return typeof step === 'string' && step.indexOf('admin_') === 0;
}

function money(n) {
  try { return new Intl.NumberFormat('ru-RU').format(n); } catch (e) { return String(n); }
}

function backRow() {
  return [vkApi.callbackButton('⬅️ В меню', 'admin:menu')];
}

function menuRows() {
  return [
    [vkApi.callbackButton('▶️ Старт', 'admin:menu')],
    [vkApi.callbackButton('➕ Добавить товар', 'admin:add')],
    [vkApi.callbackButton('✏️ Изменить товар', 'admin:edit')],
    [vkApi.callbackButton('🗑 Удалить товар', 'admin:delete')],
    [vkApi.callbackButton('📦 Управление количеством', 'admin:stock')],
    [vkApi.callbackButton('🔥 Хит', 'admin:hit')],
    [vkApi.callbackButton('📋 Заявки', 'admin:leads')]
  ];
}

async function sendMenu(userId, text) {
  await store.setSession(userId, { step: 'admin_idle' });
  await vkApi.sendMessage(
    { userId },
    text || 'Здравствуйте! Это бот управления магазином «За цветком». Выберите действие:',
    menuRows()
  );
}

// Защита от нажатия УСТАРЕВШЕЙ кнопки — ВКонтакте не убирает кнопки из старых
// сообщений в истории чата (см. подробный комментарий в проекте
// aura-tsvetov, bot/src/admin.js — тот же приём).
async function requireDraft(userId, session) {
  if (session && session.draft && typeof session.draft === 'object') return true;
  await sendMenu(userId, 'Эта кнопка уже устарела (черновик товара не сохранился). Начните заново:');
  return false;
}

function categoryButtonRows(categoryList) {
  const rows = categoryList.map((name) => [vkApi.callbackButton(name, 'add:cat:' + products.CATEGORY_NAMES.indexOf(name))]);
  rows.push(backRow());
  return rows;
}

// ---------- добавление / изменение — обычные категории ----------

function stepForField(field) {
  return 'admin_field_' + field;
}

function fieldPrompt(field, hasPhotos) {
  if (field === 'photos') {
    return hasPhotos
      ? 'Загрузите ещё фото товара. Когда закончите — нажмите «Готово».'
      : 'Загрузите одно или несколько фото товара.';
  }
  if (field === 'name') return 'Напишите название товара';
  if (field === 'composition') {
    return 'Напишите состав товара по пунктам (каждый пункт с новой строки), например:\n' +
      '• Эустома\n• Эвкалипт\n' +
      'Если состав не нужно описывать, поставьте прочерк -.';
  }
  if (field === 'extra') {
    return 'Напишите описание / доп. информацию (например, высота цветка или другое). ' +
      'Если ничего писать не нужно, поставьте прочерк -.';
  }
  if (field === 'price') return pricing.prompt;
  if (field === 'stock') return 'Напишите количество, которое в наличии. Если товар под заказ, поставьте прочерк -.';
  return 'Напишите значение';
}

function photoStepRows(hasPhotos) {
  const rows = [];
  if (hasPhotos) rows.push([vkApi.callbackButton('✅ Готово', 'photos:done')]);
  rows.push(backRow());
  return rows;
}

async function startAdd(userId) {
  await store.setSession(userId, { step: 'admin_add_category', adminAction: 'add', draft: null });
  await vkApi.sendMessage({ userId }, 'Выберите категорию товара на сайте:', categoryButtonRows(products.CATEGORY_NAMES));
}

async function pickCategory(userId, session, categoryIndex) {
  const category = products.CATEGORY_NAMES[categoryIndex];
  if (!category) {
    await vkApi.sendMessage({ userId }, 'Не поняла выбор категории, попробуйте ещё раз.');
    return;
  }

  // Смена категории уже существующего черновика (кнопка «✏️ Категория» в
  // предпросмотре) — черновик уже есть, просто меняем поле.
  if (session.draft && session.editingFromPreview) {
    session.draft.category = category;
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }

  // Новый товар — с этого момента сценарий разный для «Для бизнеса» и
  // для всех остальных категорий.
  if (products.isBusinessCategory(category)) {
    session.draft = { id: null, category, photos: [], photoPrices: [] };
    session.step = 'admin_biz_photo';
    await store.setSession(userId, session);
    await vkApi.sendMessage({ userId }, 'Загрузите фото товара.', bizPhotoStepRows(false));
    return;
  }

  session.draft = { id: null, category, photos: [] };
  session.step = stepForField('photos');
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, fieldPrompt('photos', false), photoStepRows(false));
}

function parseComposition(text) {
  if (/^-+$/.test(text.trim())) return [];
  return text
    .split('\n')
    .map((line) => line.replace(/^[\s•*-]+/, '').trim())
    .filter(Boolean);
}

async function advanceAfterField(userId, session, field) {
  if (session.editingFromPreview) {
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }
  const next = REGULAR_FIELD_ORDER[REGULAR_FIELD_ORDER.indexOf(field) + 1];
  if (!next) {
    await askHitQuestion(userId, session);
    return;
  }
  session.step = stepForField(next);
  await store.setSession(userId, session);
  if (next === 'photos') {
    const hasPhotos = (session.draft.photos || []).length > 0;
    await vkApi.sendMessage({ userId }, fieldPrompt('photos', hasPhotos), photoStepRows(hasPhotos));
  } else {
    await vkApi.sendMessage({ userId }, fieldPrompt(next), [backRow()]);
  }
}

async function handleTextField(userId, session, field, text) {
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите текст, пожалуйста.', [backRow()]);
    return;
  }
  const value = text.trim();
  if (field === 'name') {
    session.draft.name = value;
  } else if (field === 'composition') {
    session.draft.composition = parseComposition(value);
  } else if (field === 'extra') {
    session.draft.extraInfo = /^-+$/.test(value) ? '' : value;
  } else if (field === 'price') {
    Object.assign(session.draft, pricing.parse(value));
  } else if (field === 'stock') {
    if (/^-+$/.test(value)) {
      session.draft.stock = null;
    } else {
      if (!/^\d{1,5}$/.test(value) || Number(value) > 10000) {
        await vkApi.sendMessage({ userId }, 'Не вижу числа. Напишите количество цифрами, или поставьте прочерк -.', [backRow()]);
        return;
      }
      session.draft.stock = Number(value);
    }
  }
  await advanceAfterField(userId, session, field);
}

// Разбор входящих фото-вложений — формат не подтверждён живым запросом
// (см. предупреждение в проекте aura-tsvetov, bot/src/admin.js). Логирует
// сырой апдейт, если формат не распознан — после первого реального теста
// смотрите логи функции и, если нужно, правьте только эту функцию.
function extractPhotoAttachments(update) {
  const attachments = (update.message && update.message.body && update.message.body.attachments) || [];
  const photoAtts = attachments.filter((a) => a && a.type === 'image');
  const urls = [];
  photoAtts.forEach((a) => {
    const payload = a.payload || a;
    let url = payload.url || null;
    if (!url && payload.photos && typeof payload.photos === 'object') {
      const first = Object.values(payload.photos)[0];
      if (first && first.url) url = first.url;
    }
    if (url) urls.push(url);
  });
  if (photoAtts.length && !urls.length) {
    console.warn('[admin] фото-вложение без распознанного URL, апдейт целиком:', JSON.stringify(update));
  }
  return urls;
}

async function handlePhotosStep(update, userId, session) {
  const urls = extractPhotoAttachments(update);
  if (!urls.length) {
    const hasPhotos = (session.draft.photos || []).length > 0;
    const text = hasPhotos
      ? 'Пришлите фото товара (одно или несколько) или нажмите «Готово».'
      : 'Пришлите фото товара (одно или несколько).';
    await vkApi.sendMessage({ userId }, text, photoStepRows(hasPhotos));
    return;
  }
  session.draft.photos = session.draft.photos || [];
  for (const url of urls) {
    try {
      const { buffer, contentType } = await vkApi.downloadBinary(url);
      const publicUrl = await products.uploadPhoto(buffer, contentType);
      if (publicUrl) session.draft.photos.push(publicUrl);
      else await vkApi.sendMessage({ userId }, '⚠️ Не удалось сохранить фото, попробуйте прислать ещё раз.');
    } catch (e) {
      console.error('[admin] ошибка загрузки фото:', e.message);
      await vkApi.sendMessage({ userId }, '⚠️ Не удалось загрузить фото, попробуйте ещё раз.');
    }
  }
  await store.setSession(userId, session);
  const count = session.draft.photos.length;
  await vkApi.sendMessage({ userId }, 'Фото добавлено (' + count + ' шт.). Пришлите ещё или нажмите «Готово».', photoStepRows(count > 0));
}

async function finishPhotos(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  const count = (session.draft.photos || []).length;
  if (!count) {
    await vkApi.sendMessage({ userId }, 'Нужно хотя бы одно фото. Пришлите фото товара.', photoStepRows(false));
    return;
  }
  await advanceAfterField(userId, session, 'photos');
}

// ---------- добавление / изменение — «Для бизнеса» ----------

function bizPhotoStepRows(hasPhotos) {
  const rows = [];
  if (hasPhotos) rows.push([vkApi.callbackButton('✅ Готово', 'biz:photo:done')]);
  rows.push(backRow());
  return rows;
}

async function handleBizPhotoStep(update, userId, session) {
  const urls = extractPhotoAttachments(update);
  const hasPhotos = (session.draft.photos || []).length > 0;
  if (!urls.length) {
    await vkApi.sendMessage(
      { userId },
      hasPhotos ? 'Пришлите ещё фото или нажмите «Готово».' : 'Пришлите фото товара.',
      bizPhotoStepRows(hasPhotos)
    );
    return;
  }
  if (urls.length > 1) {
    await vkApi.sendMessage(
      { userId },
      'Для категории «Для бизнеса» присылайте фото по одному — у каждого своя цена. Обработала первое, остальные пришлите следующими сообщениями.'
    );
  }
  try {
    const { buffer, contentType } = await vkApi.downloadBinary(urls[0]);
    const publicUrl = await products.uploadPhoto(buffer, contentType);
    if (!publicUrl) {
      await vkApi.sendMessage({ userId }, '⚠️ Не удалось сохранить фото, попробуйте прислать ещё раз.', bizPhotoStepRows(hasPhotos));
      return;
    }
    session.pendingPhotoUrl = publicUrl;
    session.step = 'admin_biz_price';
    await store.setSession(userId, session);
    await vkApi.sendMessage({ userId }, 'Оформление на фото. '+pricing.prompt, [backRow()]);
  } catch (e) {
    console.error('[admin] ошибка загрузки фото:', e.message);
    await vkApi.sendMessage({ userId }, '⚠️ Не удалось загрузить фото, попробуйте ещё раз.', bizPhotoStepRows(hasPhotos));
  }
}

async function handleBizPriceText(userId, session, text) {
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите цену, пожалуйста.', [backRow()]);
    return;
  }
  const entered = pricing.parse(text);
  session.draft.photoPriceLabels = (session.draft.photos || []).map((_,i)=>pricing.format((session.draft.photoPrices||[])[i],(session.draft.photoPriceLabels||[])[i]));
  session.draft.photos = session.draft.photos || [];
  session.draft.photoPrices = session.draft.photoPrices || [];
  session.draft.photos.push(session.pendingPhotoUrl);
  session.draft.photoPrices.push(entered.price);
  session.draft.photoPriceLabels.push(entered.priceLabel);
  delete session.pendingPhotoUrl;
  session.step = 'admin_biz_photo';
  await store.setSession(userId, session);
  await vkApi.sendMessage(
    { userId },
    'Фото добавлено (' + session.draft.photos.length + ' шт.). Пришлите ещё фото или нажмите «Готово».',
    bizPhotoStepRows(true)
  );
}

async function finishBizPhotos(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  const count = (session.draft.photos || []).length;
  if (!count) {
    await vkApi.sendMessage({ userId }, 'Нужно хотя бы одно фото. Пришлите фото товара.', bizPhotoStepRows(false));
    return;
  }
  if (session.editingFromPreview) {
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }
  session.step = 'admin_field_name';
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, 'Напишите название товара', [backRow()]);
}

async function handleBizNameText(userId, session, text) {
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите текст, пожалуйста.', [backRow()]);
    return;
  }
  session.draft.name = text.trim();
  if (session.editingFromPreview) {
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }
  await sendBizNoteConfirm(userId, session);
}

async function sendBizNoteConfirm(userId, session) {
  session.step = 'admin_biz_note_confirm';
  await store.setSession(userId, session);
  await vkApi.sendMessage(
    { userId },
    'Описание: ' + products.BUSINESS_NOTE,
    [[vkApi.callbackButton('Оставить так', 'biz:note:keep'), vkApi.callbackButton('Изменить', 'biz:note:edit')], backRow()]
  );
}

async function keepBizNote(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.draft.note = products.BUSINESS_NOTE;
  if (session.editingFromPreview) {
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }
  await askHitQuestion(userId, session);
}

async function startEditBizNote(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.step = 'admin_biz_note_edit';
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, 'Напишите новый текст описания (или «-», чтобы вернуть текст по умолчанию):', [backRow()]);
}

async function handleBizNoteEditText(userId, session, text) {
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите текст, пожалуйста.', [backRow()]);
    return;
  }
  const value = text.trim();
  session.draft.note = /^-+$/.test(value) ? products.BUSINESS_NOTE : value;
  if (session.editingFromPreview) {
    session.editingFromPreview = false;
    session.step = 'admin_preview';
    await store.setSession(userId, session);
    await sendPreview(userId, session);
    return;
  }
  await askHitQuestion(userId, session);
}

function bizPhotoManageRows(photos) {
  const rows = photos.map((url, i) => [vkApi.callbackButton('🗑 Удалить фото ' + (i + 1), 'biz:photo:remove:' + i)]);
  rows.push([vkApi.callbackButton('➕ Добавить фото', 'biz:photo:add')]);
  rows.push([vkApi.callbackButton('⬅️ Назад к предпросмотру', 'biz:photo:back')]);
  return rows;
}

async function sendBizPhotoManageMenu(userId, session) {
  session.step = 'admin_manage_biz_photos';
  await store.setSession(userId, session);
  const photos = session.draft.photos || [];
  const prices = session.draft.photoPrices || [];
  const lines = photos.map((url, i) => (i + 1) + '. Оформление на фото: ' + pricing.format(prices[i],(session.draft.photoPriceLabels||[])[i]));
  await vkApi.sendMessage({ userId }, 'Фото товара (' + photos.length + ' шт.):\n' + lines.join('\n'), bizPhotoManageRows(photos));
}

async function removeBizPhoto(userId, session, index) {
  if (!(await requireDraft(userId, session))) return;
  const photos = session.draft.photos || [];
  const prices = session.draft.photoPrices || [];
  if (index >= 0 && index < photos.length) {
    photos.splice(index, 1);
    prices.splice(index, 1);
    if(session.draft.photoPriceLabels)session.draft.photoPriceLabels.splice(index,1);
  }
  session.draft.photos = photos;
  session.draft.photoPrices = prices;
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, 'Фото удалено.', bizPhotoManageRows(photos));
}

async function addMoreBizPhotos(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.editingFromPreview = true;
  session.step = 'admin_biz_photo';
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, 'Пришлите фото товара. Когда закончите — нажмите «Готово».', bizPhotoStepRows((session.draft.photos || []).length > 0));
}

async function backToPreviewFromBizPhotos(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.step = 'admin_preview';
  await store.setSession(userId, session);
  await sendPreview(userId, session);
}

// ---------- «Хит» ----------

async function askHitQuestion(userId, session) {
  session.step = 'admin_hit_question';
  await store.setSession(userId, session);
  await vkApi.sendMessage(
    { userId },
    'Пометить товар Хитом? Хиты показываются в самом начале галереи на сайте.',
    [[vkApi.callbackButton('Да', 'hit:set:1'), vkApi.callbackButton('Нет', 'hit:set:0')], backRow()]
  );
}

async function setHit(userId, session, value) {
  if (!(await requireDraft(userId, session))) return;
  session.draft.isHit = value;
  session.editingFromPreview = false;
  session.step = 'admin_preview';
  await store.setSession(userId, session);
  await sendPreview(userId, session);
}

// ---------- предпросмотр ----------

function splitDescription(description) {
  const parts = String(description || '').split(' · ').map((s) => s.trim()).filter(Boolean);
  const heightPart = parts.find((p) => /^высота/i.test(p));
  return { composition: parts.filter((p) => p !== heightPart), heightPart: heightPart || '' };
}

function formatRegularPreviewText(draft) {
  const lines = ['Проверьте товар перед публикацией:', '', 'Категория: ' + draft.category, 'Название: ' + draft.name];
  if (draft.composition && draft.composition.length) {
    lines.push('Состав:');
    draft.composition.forEach((line) => lines.push('• ' + line));
  } else {
    lines.push('Состав: не указан');
  }
  lines.push('Описание/доп. информация: ' + (draft.extraInfo || 'не указано'));
  lines.push('Цена: ' + pricing.format(draft.price,draft.priceLabel));
  lines.push('Количество: ' + (draft.stock === null || draft.stock === undefined ? 'под заказ' : draft.stock + ' шт.'));
  lines.push('Фото: ' + (draft.photos || []).length + ' шт.');
  lines.push('Хит: ' + (draft.isHit ? 'да' : 'нет'));
  return lines.join('\n');
}

function formatBusinessPreviewText(draft) {
  const lines = ['Проверьте товар перед публикацией:', '', 'Категория: Для бизнеса', 'Название: ' + draft.name];
  (draft.photos || []).forEach((url, i) => {
    lines.push('Фото ' + (i + 1) + ' — Оформление на фото: ' + pricing.format((draft.photoPrices || [])[i],(draft.photoPriceLabels||[])[i]));
  });
  lines.push('Описание: ' + (draft.note || products.BUSINESS_NOTE));
  const prices = draft.photoPrices || [];
  const summary=pricing.business(prices,draft.photoPriceLabels);
  const priceText = summary.priceLabel || (summary.price===summary.maxPrice?pricing.format(summary.price):pricing.format(summary.price)+' – '+pricing.format(summary.maxPrice));
  lines.push('Цена (считается автоматически по фото): ' + priceText);
  lines.push('Хит: ' + (draft.isHit ? 'да' : 'нет'));
  return lines.join('\n');
}

function previewRows(isBusiness) {
  const rows = [];
  if (!isBusiness) rows.push([vkApi.callbackButton('✏️ Категория', 'edit:field:category')]);
  rows.push([vkApi.callbackButton('✏️ Фото', 'edit:field:photos')]);
  rows.push([vkApi.callbackButton('✏️ Название', 'edit:field:name')]);
  if (!isBusiness) {
    rows.push([vkApi.callbackButton('✏️ Состав', 'edit:field:composition')]);
    rows.push([vkApi.callbackButton('✏️ Описание/доп. информация', 'edit:field:extra')]);
    rows.push([vkApi.callbackButton('✏️ Цена', 'edit:field:price')]);
    rows.push([vkApi.callbackButton('✏️ Количество', 'edit:field:stock')]);
  } else {
    rows.push([vkApi.callbackButton('✏️ Описание', 'edit:field:note')]);
  }
  rows.push([vkApi.callbackButton('🔥 Хит', 'edit:field:isHit')]);
  rows.push([vkApi.callbackButton('💾 Сохранить', 'preview:save')]);
  rows.push([vkApi.callbackButton('❌ Отмена', 'preview:cancel')]);
  return rows;
}

async function sendPreview(userId, session) {
  const isBusiness = products.isBusinessCategory(session.draft.category);
  const text = isBusiness ? formatBusinessPreviewText(session.draft) : formatRegularPreviewText(session.draft);
  const photoUrl = (session.draft.photos || [])[0];
  const rows = previewRows(isBusiness);
  if (photoUrl) {
    const result = await vkApi.sendPhotoUrlMessage({ userId }, text, rows, photoUrl);
    if (!result.ok) await vkApi.sendMessage({ userId }, text, rows);
  } else {
    await vkApi.sendMessage({ userId }, text, rows);
  }
}

async function editField(userId, session, field) {
  if (!(await requireDraft(userId, session))) return;
  const isBusiness = products.isBusinessCategory(session.draft.category);

  if (field === 'category') {
    session.editingFromPreview = true;
    session.step = 'admin_add_category';
    await store.setSession(userId, session);
    const sameType = products.CATEGORY_NAMES.filter((c) => products.isBusinessCategory(c) === isBusiness);
    await vkApi.sendMessage({ userId }, 'Выберите новую категорию товара:', categoryButtonRows(sameType));
    return;
  }
  if (field === 'photos') {
    if (isBusiness) await sendBizPhotoManageMenu(userId, session);
    else await sendPhotoManageMenu(userId, session);
    return;
  }
  if (field === 'note') {
    await startEditBizNote(userId, session);
    return;
  }
  if (field === 'isHit') {
    session.editingFromPreview = true;
    session.step = 'admin_hit_question';
    await store.setSession(userId, session);
    if (session.draft.isHit) {
      await vkApi.sendMessage({ userId }, 'Убрать товар из Хитов?', [[vkApi.callbackButton('Да', 'hit:set:0'), vkApi.callbackButton('Нет', 'hit:set:1')], backRow()]);
    } else {
      await vkApi.sendMessage(
        { userId },
        'Пометить товар Хитом? Хиты показываются в самом начале галереи на сайте.',
        [[vkApi.callbackButton('Да', 'hit:set:1'), vkApi.callbackButton('Нет', 'hit:set:0')], backRow()]
      );
    }
    return;
  }
  if (field === 'name' && isBusiness) {
    session.editingFromPreview = true;
    session.step = 'admin_field_name';
    await store.setSession(userId, session);
    await vkApi.sendMessage({ userId }, 'Напишите название товара', [backRow()]);
    return;
  }

  // Обычные поля (name/composition/extra/price/stock) для НЕ-бизнес товара.
  session.editingFromPreview = true;
  session.step = stepForField(field);
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, fieldPrompt(field), [backRow()]);
}

function photoManageRows(photos) {
  const rows = photos.map((url, i) => [vkApi.callbackButton('🗑 Удалить фото ' + (i + 1), 'photos:remove:' + i)]);
  rows.push([vkApi.callbackButton('➕ Добавить фото', 'photos:add')]);
  rows.push([vkApi.callbackButton('⬅️ Назад к предпросмотру', 'photos:back')]);
  return rows;
}

async function sendPhotoManageMenu(userId, session) {
  session.step = 'admin_manage_photos';
  await store.setSession(userId, session);
  const photos = session.draft.photos || [];
  await vkApi.sendMessage({ userId }, 'Фото товара (' + photos.length + ' шт.). Что сделать?', photoManageRows(photos));
}

async function removePhoto(userId, session, index) {
  if (!(await requireDraft(userId, session))) return;
  const photos = session.draft.photos || [];
  if (index >= 0 && index < photos.length) photos.splice(index, 1);
  session.draft.photos = photos;
  await store.setSession(userId, session);
  await vkApi.sendMessage({ userId }, 'Фото удалено.', photoManageRows(photos));
}

async function addMorePhotos(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.editingFromPreview = true;
  session.step = stepForField('photos');
  await store.setSession(userId, session);
  const hasPhotos = (session.draft.photos || []).length > 0;
  await vkApi.sendMessage({ userId }, fieldPrompt('photos', hasPhotos), photoStepRows(hasPhotos));
}

async function backToPreview(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  session.step = 'admin_preview';
  await store.setSession(userId, session);
  await sendPreview(userId, session);
}

async function saveDraft(userId, session) {
  if (!(await requireDraft(userId, session))) return;
  const draft = session.draft;
  const isBusiness = products.isBusinessCategory(draft.category);
  try {
    const fields = isBusiness
      ? { name: draft.name, photos: draft.photos, photoPrices: draft.photoPrices, photoPriceLabels:draft.photoPriceLabels, note: draft.note, isHit: draft.isHit }
      : { name: draft.name, price: draft.price, priceLabel:draft.priceLabel, composition: draft.composition, extraInfo: draft.extraInfo, stock: draft.stock, photos: draft.photos, isHit: draft.isHit };
    const product = await products.saveProduct(draft.category, draft.id, fields);
    await sendMenu(userId, '✅ Товар «' + product.name + '» опубликован на сайте (' + draft.category + ').');
  } catch (e) {
    console.error('[admin] ошибка сохранения товара:', e.message);
    await vkApi.sendMessage({ userId }, '⚠️ Не удалось сохранить товар: ' + e.message, previewRows(isBusiness));
  }
}

async function cancelDraft(userId) {
  await sendMenu(userId, 'Действие отменено.');
}

// ---------- поиск товара (для «Изменить»/«Удалить»/«Управление количеством») ----------

async function startFind(userId, action) {
  await store.setSession(userId, { step: 'admin_find_name', adminAction: action });
  if (action === 'hit') {
    await vkApi.sendMessage({ userId }, 'Напишите название товара, чтобы поставить или снять отметку «Хит».', [backRow()]);
    return;
  }
  if (action === 'stock') {
    await vkApi.sendMessage({ userId }, 'Напишите название товара, чтобы изменить его количество.', [backRow()]);
    return;
  }
  const verb = action === 'delete' ? 'удалить' : 'изменить';
  await vkApi.sendMessage({ userId }, 'Напишите название товара, который нужно ' + verb + '.', [backRow()]);
}

function matchCardText(product, category) {
  const lines = [product.name];
  if (product.business) {
    const prices = product.photoPrices || [];
    lines.push(prices.length && Math.min(...prices) !== Math.max(...prices) ? money(Math.min(...prices)) + '–' + money(Math.max(...prices)) + ' ₽' : money(product.price) + ' ₽');
  } else {
    lines.push(money(product.price) + ' ₽');
    const { composition } = splitDescription(product.description);
    if (composition.length) {
      lines.push('');
      composition.forEach((line) => lines.push('• ' + line));
    }
  }
  lines.push('');
  lines.push('Категория: ' + category);
  return lines.join('\n');
}

async function handleFindName(userId, session, text) {
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите название товара текстом.', [backRow()]);
    return;
  }
  const query = text.trim();
  const matches = await products.searchByName(query, 5);
  if (!matches.length) {
    await vkApi.sendMessage({ userId }, 'Ничего не найдено похожего на «' + query + '». Попробуйте написать по-другому.', [backRow()]);
    return;
  }
  session.matches = matches.map((m) => ({ category: m.category, id: m.product.id }));
  session.findQuery = query;
  await store.setSession(userId, session);
  // One compact response avoids slow re-upload of up to five photos to VK,
  // webhook timeouts, partial result lists and repeated cards on delivery retry.
  const lines = matches.map(({product,category},i)=>
    (i+1)+'. '+product.name+' — '+pricing.format(product.price,product.priceLabel)+' ('+category+')');
  const rows = matches.map(({product},i)=>[vkApi.callbackButton((i+1)+'. '+product.name,'find:pick:'+i)]);
  rows.push(backRow());
  await vkApi.sendMessage({userId},'Выберите товар:\n\n'+lines.join('\n'),rows);
}

async function pickMatch(userId, session, index) {
  // A repeated click/retried selection must not restart the quantity prompt.
  if (session.step !== 'admin_find_name') return;
  const match = (session.matches || [])[index];
  if (!match) {
    await sendMenu(userId);
    return;
  }
  const product = await products.getProductById(match.id);
  if (!product) {
    await vkApi.sendMessage({ userId }, 'Этот товар уже не найден — возможно, его удалили.');
    await sendMenu(userId);
    return;
  }

  if (session.adminAction === 'hit') {
    session.step = 'admin_hit_existing';
    session.hitTarget = { id: product.id, name: product.name };
    await store.setSession(userId, session);
    await vkApi.sendMessage({ userId }, 'Товар «' + product.name + '». Хит: ' + (product.isHit ? 'да' : 'нет') + '.', [
      [vkApi.callbackButton(product.isHit ? 'Убрать из Хитов' : '🔥 Пометить Хитом', product.isHit ? 'existing:hit:0' : 'existing:hit:1')], backRow()
    ]);
    return;
  }
  if (session.adminAction === 'delete') {
    session.step = 'admin_confirm_delete';
    session.deleteTarget = { id: product.id, name: product.name };
    await store.setSession(userId, session);
    await vkApi.sendMessage(
      { userId },
      'Удалить товар «' + product.name + '»?',
      [[vkApi.callbackButton('Да', 'delete:confirm:yes'), vkApi.callbackButton('Нет', 'delete:confirm:no')]]
    );
    return;
  }

  if (session.adminAction === 'stock') {
    session.step = 'admin_stock_new_value';
    session.stockTarget = { id: product.id, name: product.name };
    await store.setSession(userId, session);
    const current = product.business
      ? 'не отслеживается (категория «Для бизнеса»)'
      : (product.stock === null || product.stock === undefined ? 'под заказ' : product.stock + ' шт.');
    await vkApi.sendMessage(
      { userId },
      'Товар «' + product.name + '». Сейчас: ' + current + '.\nНапишите новое количество (или «-» для «под заказ»):',
      [backRow()]
    );
    return;
  }

  // edit
  session.step = 'admin_preview';
  session.adminAction = 'edit';
  if (product.business) {
    session.draft = {
      id: product.id,
      category: match.category,
      name: product.name,
      photos: (product.images || []).slice(),
      photoPrices: (product.photoPrices || []).slice(),
      photoPriceLabels:(product.photoPriceLabels||[]).slice(),
      note: product.note || products.BUSINESS_NOTE,
      isHit: Boolean(product.isHit)
    };
  } else {
    const { composition, heightPart } = splitDescription(product.description);
    session.draft = {
      id: product.id,
      category: match.category,
      name: product.name,
      price: product.price,
      priceLabel:product.priceLabel||'',
      composition,
      extraInfo: product.note || heightPart || '',
      stock: product.stock === undefined ? null : product.stock,
      photos: (product.images || []).slice(),
      isHit: Boolean(product.isHit)
    };
  }
  await store.setSession(userId, session);
  await sendPreview(userId, session);
}

async function confirmDelete(userId, session, yes) {
  if (!yes) {
    await sendMenu(userId, 'Отменено.');
    return;
  }
  const target = session.deleteTarget;
  if (!target) {
    await sendMenu(userId);
    return;
  }
  await products.deleteProductById(target.id);
  await sendMenu(userId, '🗑 Товар «' + target.name + '» удалён.');
}

async function handleStockValue(userId, session, text) {
  if (!text || !text.trim()) return;
  const target = session.stockTarget;
  if (!target) {
    await sendMenu(userId);
    return;
  }
  const value = text.trim();
  // A button echo/late search text is not a numeric answer. Do not send a
  // second quantity prompt for it. Invalid numeric input still gets feedback.
  if (!/^[\d.,+\-\s]+$/.test(value)) return;
  let newStock;
  if (/^-+$/.test(value)) {
    newStock = null;
  } else {
    if (!/^\d{1,5}$/.test(value) || Number(value) > 10000) {
      await vkApi.sendMessage({ userId }, 'Допустимо целое число от 0 до 10000 или «-».', [backRow()]);
      return;
    }
    newStock = Number(value);
  }
  try {
    const saved = await products.updateStock(target.id, newStock);
    if (!saved) return sendMenu(userId, 'Товар уже удалён. Найдите другой товар.');
    await sendMenu(userId, '✅ Количество товара «' + target.name + '» сохранено в каталоге: ' + (newStock === null ? 'под заказ' : newStock + ' шт.') + '. Изменение сохранено на REG.RU и появится на сайте при обновлении страницы.');
  } catch (error) {
    const explanations = {
      403:'REG.RU отклонил доступ к записи (HTTP 403). Нужно проверить передачу секрета каталога.',
      405:'Хостинг отклонил метод записи (HTTP 405).',
      409:'Каталог уже изменён другим действием (HTTP 409). Найдите товар заново.',
      422:'REG.RU отклонил данные каталога (HTTP 422). Нужна проверка каталога на сервере.',
      503:'Сервис каталога REG.RU временно недоступен (HTTP 503).'
    };
    await vkApi.sendMessage({ userId }, 'Сохранение количества не подтверждено. '+(explanations[error.status] || 'Не удалось получить подтверждение от REG.RU. Проверьте количество перед повторной попыткой.'), [backRow()]);
  }
}

// ---------- заявки ----------

function formatLead(lead) {
  let when = lead.createdAt || '';
  try {
    const d = new Date(lead.createdAt);
    when = d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { /* оставляем как есть */ }

  const lines = [when, lead.kind === 'question' ? '❓ Вопрос в чате' : '🛒 Заказ с сайта'];
  lines.push('Источник: ' + (lead.source || '—'));
  if (lead.name) lines.push('Имя: ' + lead.name);
  if (lead.phone) lines.push('Телефон: ' + lead.phone);
  if (lead.productName) lines.push('Товар: ' + lead.productName);
  if (lead.question) lines.push('Вопрос: ' + lead.question);
  lines.push(lead.isRepeat ? '👤 Повторное обращение' : '🆕 Первое обращение');
  return lines.join('\n');
}

async function sendLeads(userId, offset) {
  const panel = new URL(config.ownerOrdersUrl);
  if (panel.protocol !== 'https:' || panel.username || panel.password || panel.search || panel.hash) throw new Error('Invalid panel URL');
  return vkApi.sendMessage({userId}, 'Все заявки сайта, контакты и пожелания находятся в закрытой панели Екатерины. Для просмотра войдите с личным логином и паролем.', [[vkApi.linkButton('Открыть заявки', panel.href)]]);
}

// Historical JSON leads are retained; no longer used as the website inbox.
async function sendLegacyLeads(userId, offset) {
  const page = await store.getLeadsPage(offset || 0, 10);
  if (!page.items.length) {
    await vkApi.sendMessage({ userId }, offset ? 'Больше заявок нет.' : 'Заявок пока нет.', [backRow()]);
    return;
  }
  const text = page.items.map(formatLead).join('\n\n———\n\n');
  const rows = [];
  const shown = (offset || 0) + page.items.length;
  if (shown < page.total) rows.push([vkApi.callbackButton('Показать ещё', 'admin:leads:' + shown)]);
  rows.push(backRow());
  await vkApi.sendMessage({ userId }, 'Заявки (' + ((offset || 0) + 1) + '–' + shown + ' из ' + page.total + '):\n\n' + text, rows);
}

// ---------- диспетчер ----------

async function handleCallback(userId, session, data) {
  if (data === 'admin:menu') { await sendMenu(userId); return true; }
  if (data === 'admin:add') { await startAdd(userId); return true; }
  if (data === 'admin:edit') { await startFind(userId, 'edit'); return true; }
  if (data === 'admin:delete') { await startFind(userId, 'delete'); return true; }
  if (data === 'admin:stock') { await startFind(userId, 'stock'); return true; }
  if (data === 'admin:hit') { await startFind(userId, 'hit'); return true; }
  if (data === 'existing:hit:1' || data === 'existing:hit:0') {
    if (session.step !== 'admin_hit_existing' || !session.hitTarget) {
      await sendMenu(userId, 'Эта кнопка уже устарела. Выберите товар заново.');
      return true;
    }
    try {
      const product = await products.updateHit(session.hitTarget.id, data === 'existing:hit:1');
      await sendMenu(userId, product ? '✅ Товар «' + product.name + '»: ' + (product.isHit ? 'помечен Хитом и перенесён в начало раздела.' : 'отметка «Хит» снята.') : 'Товар уже удалён.');
    } catch (error) {
      await vkApi.sendMessage({ userId }, 'Не удалось сохранить отметку «Хит». Попробуйте ещё раз.', [backRow()]);
    }
    return true;
  }
  if (data === 'admin:leads') { await sendLeads(userId, 0); return true; }
  if (data.indexOf('admin:leads:') === 0) { await sendLeads(userId, parseInt(data.slice('admin:leads:'.length), 10) || 0); return true; }

  if (data.indexOf('add:cat:') === 0) { await pickCategory(userId, session, parseInt(data.slice('add:cat:'.length), 10)); return true; }
  if (data.indexOf('edit:field:') === 0) { await editField(userId, session, data.slice('edit:field:'.length)); return true; }
  if (data === 'preview:save') { await saveDraft(userId, session); return true; }
  if (data === 'preview:cancel') { await cancelDraft(userId); return true; }

  if (data === 'photos:done') { await finishPhotos(userId, session); return true; }
  if (data === 'photos:add') { await addMorePhotos(userId, session); return true; }
  if (data === 'photos:back') { await backToPreview(userId, session); return true; }
  if (data.indexOf('photos:remove:') === 0) { await removePhoto(userId, session, parseInt(data.slice('photos:remove:'.length), 10)); return true; }

  if (data === 'biz:photo:done') { await finishBizPhotos(userId, session); return true; }
  if (data === 'biz:photo:add') { await addMoreBizPhotos(userId, session); return true; }
  if (data === 'biz:photo:back') { await backToPreviewFromBizPhotos(userId, session); return true; }
  if (data.indexOf('biz:photo:remove:') === 0) { await removeBizPhoto(userId, session, parseInt(data.slice('biz:photo:remove:'.length), 10)); return true; }
  if (data === 'biz:note:keep') { await keepBizNote(userId, session); return true; }
  if (data === 'biz:note:edit') { await startEditBizNote(userId, session); return true; }

  if (data === 'hit:set:1') { await setHit(userId, session, true); return true; }
  if (data === 'hit:set:0') { await setHit(userId, session, false); return true; }

  if (data.indexOf('find:pick:') === 0) { await pickMatch(userId, session, parseInt(data.slice('find:pick:'.length), 10)); return true; }
  if (data === 'delete:confirm:yes') { await confirmDelete(userId, session, true); return true; }
  if (data === 'delete:confirm:no') { await confirmDelete(userId, session, false); return true; }
  return false;
}

async function handleMessage(update, userId, session) {
  const text = (update.message && update.message.body && update.message.body.text) || null;
  switch (session.step) {
    case 'admin_field_name':
      return products.isBusinessCategory(session.draft && session.draft.category)
        ? handleBizNameText(userId, session, text)
        : handleTextField(userId, session, 'name', text);
    case 'admin_field_composition': return handleTextField(userId, session, 'composition', text);
    case 'admin_field_extra': return handleTextField(userId, session, 'extra', text);
    case 'admin_field_price': return handleTextField(userId, session, 'price', text);
    case 'admin_field_stock': return handleTextField(userId, session, 'stock', text);
    case 'admin_field_photos': return handlePhotosStep(update, userId, session);
    case 'admin_biz_photo': return handleBizPhotoStep(update, userId, session);
    case 'admin_biz_price': return handleBizPriceText(userId, session, text);
    case 'admin_biz_note_edit': return handleBizNoteEditText(userId, session, text);
    case 'admin_find_name':
      session.findMessageId = update.message && update.message.body && update.message.body.mid;
      return handleFindName(userId, session, text);
    case 'admin_stock_new_value': {
      // VK can retry the earlier search message after the product was selected.
      // Neither that message nor a selection-button echo is a quantity answer.
      const mid = update.message && update.message.body && update.message.body.mid;
      if ((mid != null && session.findMessageId != null && String(mid) === String(session.findMessageId))
          || (text && text.trim() === 'Этот товар')
          || (text && session.findQuery && text.trim() === session.findQuery && !/^[\d-]+$/.test(text.trim()))) return;
      return handleStockValue(userId, session, text);
    }
    default:
      // Шаги с кнопками (выбор категории/подтверждение/предпросмотр/меню
      // фото/описания) не ждут текст — не сбрасываем черновик, просто
      // напоминаем про кнопки, чтобы случайное сообщение не потеряло уже
      // собранные данные товара.
      await vkApi.sendMessage({ userId }, 'Пожалуйста, воспользуйтесь кнопками выше (или «⬅️ В меню»).', [backRow()]);
  }
}

module.exports = {
  isAdminStep,
  sendMenu,
  handleCallback,
  handleMessage
};
