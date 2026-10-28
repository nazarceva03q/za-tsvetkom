// Domain scenarios receive normalized VK events from vkWebhook.js.
const config = require('./config');
const crypto = require('crypto');
const store = require('./store');
const vkApi = require('./vkApi');
const notify = require('./notify');
const admin = require('./admin');

// ---------- разбор апдейта (см. предупреждение выше) ----------

function extractUserId(update) {
  return (
    (update.user && update.user.user_id) ||
    (update.callback && update.callback.user && update.callback.user.user_id) ||
    (update.message && update.message.sender && update.message.sender.user_id) ||
    update.user_id ||
    null
  );
}

function extractAutoName(update) {
  const u = update.user || (update.message && update.message.sender) || null;
  if (!u) return null;
  const name = [u.first_name || u.name, u.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

// Кликабельная ссылка на профиль спрашивающего – через https://vk.com/id<id>.
async function sendAskerInfo(targetUserId, name, askerId, phone) {
  const label = name || ('Пользователь ' + askerId);
  const lines = [vkApi.userMention(label, askerId)];
  if (phone) lines.push('📞 ' + notify.formatPhone(phone));
  await vkApi.sendMarkdownMessage({ userId: targetUserId }, lines.join('\n'));
}

function extractCallbackData(update) {
  return (
    update.callback_data ||
    (update.callback && (update.callback.payload || update.callback.callback_data)) ||
    (update.update_type === 'message_callback' ? update.payload : null) ||
    null
  );
}

function extractMessageText(update) {
  return (update.message && update.message.body && update.message.body.text) || update.text || null;
}

function parseVcfPhone(vcf) {
  if (!vcf) return null;
  const m = vcf.match(/TEL[^:]*:([+\d][\d\s()-]*)/i);
  return m ? m[1].replace(/\s+/g, '') : null;
}
function parseVcfName(vcf) {
  if (!vcf) return null;
  const m = vcf.match(/FN:([^\r\n]+)/i);
  return m ? m[1].trim() : null;
}

function extractContact(update) {
  const attachments = (update.message && update.message.body && update.message.body.attachments) || [];
  const contactAtt = attachments.find((a) => a && a.type === 'contact');
  if (!contactAtt) return null;
  const payload = contactAtt.payload || contactAtt;
  const vcf = payload.vcf_info || payload.vcf || null;
  return {
    phone: parseVcfPhone(vcf) || payload.phone_number || payload.phone || null,
    name: parseVcfName(vcf) || payload.name || null
  };
}

// ---------- вспомогательное ----------

function isValidPhone(rawPhone) {
  return /^7\d{10}$/.test(notify.normalizePhone(rawPhone));
}

// ---------- согласие на обработку персональных данных ----------

function consentUrl() {
  return config.siteBaseUrl + '/legal.html#consent';
}

function consentRows() {
  return [[vkApi.callbackButton('☑️ Согласен(на)', 'consent:start')]];
}

async function sendGreeting(userId) {
  await store.setSession(userId, { step: 'awaiting_consent' });
  await vkApi.sendMessage(
    { userId },
    'Добрый день!\n\n' +
      'Чтобы начать диалог, пожалуйста, подтвердите согласие на обработку персональных данных ' +
      '(имя, телефон) в соответствии с 152-ФЗ.\n' +
      'Ознакомиться: ' + consentUrl(),
    consentRows()
  );
}

async function remindAboutConsent(userId) {
  await vkApi.sendMessage(
    { userId },
    'Чтобы продолжить, подтвердите, пожалуйста, согласие на обработку персональных данных — нажмите кнопку выше.',
    consentRows()
  );
}

async function proceedAfterConsent(userId) {
  await store.setSession(userId, { step: 'awaiting_message' });
  await vkApi.sendMessage({ userId }, 'Чем можем вам помочь? Ответим здесь в чате как можно скорее');
}

// ---------- служебный чат владелицы/администраторов ----------

async function sendOwnerNotice(userId) {
  await admin.sendMenu(
    userId,
    'Меню управления магазином. Покупателям отвечайте напрямую в сообщениях сообщества:'
  );
}

// ---------- первый вопрос → запрос телефона → пересылка владелице ----------

async function handleAwaitingMessage(update, userId, session) {
  const text = extractMessageText(update);
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId }, 'Напишите, пожалуйста, ваш вопрос одним сообщением.');
    return;
  }

  session.step = 'awaiting_phone';
  session.pendingText = text.trim();
  session.name = extractAutoName(update) || session.name || '';
  await store.setSession(userId, session);

  await vkApi.sendMessage(
    { userId },
    'Чтобы передать ваш вопрос, поделитесь, пожалуйста, номером телефона.\n' +
      'Напишите номер в чат, например: +7 999 123-45-67.'
  );
}

async function handleAwaitingPhone(update, userId, session) {
  const contact = extractContact(update);
  const text = extractMessageText(update);
  const phone = contact && contact.phone ? contact.phone : text;

  if (!phone || !isValidPhone(phone)) {
    await vkApi.sendMessage(
      { userId },
      'Не получилось распознать номер. Отправьте его ещё раз, например: +7 999 123-45-67'
    );
    return;
  }

  const name = (contact && contact.name) || extractAutoName(update) || session.name || '';
  const normalizedPhone = notify.normalizePhone(phone);

  const pendingText = session.pendingText;
  await forwardToOwner(userId, pendingText, name, normalizedPhone);
  session.step = 'chatting';
  session.name = name;
  session.phone = normalizedPhone;
  delete session.pendingText;
  await store.setSession(userId, session);

  await vkApi.sendMessage(
    { userId },
    (name ? 'Спасибо, ' + name + '! ' : 'Спасибо! ') + 'Мы получили ваше сообщение, скоро ответим!'
  );
}

async function handleChatting(update, userId, session) {
  const text = extractMessageText(update);
  if (!text || !text.trim()) return;
  await forwardToOwner(userId, text.trim(), session.name, session.phone);
}

async function forwardToOwner(userId, text, name, phone) {
  if (!config.ownerChatId) {
    throw new Error('VK_OWNER_ID не настроен');
  }
  const questionId = 'q' + crypto.randomUUID();
  await store.saveQuestion(questionId, userId, text, name, phone);
  await store.saveLead({
    kind: 'question',
    source: 'Чат бота ВКонтакте',
    name: name || '',
    phone: phone ? notify.formatPhone(phone) : '',
    question: text
  });
  await sendAskerInfo(config.ownerChatId, name, userId, phone);
  await vkApi.sendMessage(
    { userId: config.ownerChatId },
    '❓ Вопрос: ' + text,
    [[vkApi.callbackButton('Ответить', 'answer:' + questionId)]]
  );
}

async function startAnswerFlow(ownerUserId, questionId) {
  const question = await store.getQuestion(questionId);
  if (!question) {
    await vkApi.sendMessage({ userId: ownerUserId }, 'Этот вопрос не найден — возможно, уже отвечен или устарел.');
    return;
  }
  await store.setSession(ownerUserId, { step: 'awaiting_answer', answeringQuestionId: questionId });
  await sendAskerInfo(ownerUserId, question.userName, question.userId, question.userPhone);
  await vkApi.sendMessage({ userId: ownerUserId }, 'Напишите текст ответа:');
}

async function handleAwaitingAnswer(update, ownerUserId, session) {
  const text = extractMessageText(update);
  if (!text || !text.trim()) {
    await vkApi.sendMessage({ userId: ownerUserId }, 'Напишите ответ одним сообщением, пожалуйста.');
    return;
  }
  const question = await store.getQuestion(session.answeringQuestionId);
  if (!question) {
    await vkApi.sendMessage({ userId: ownerUserId }, 'Не нашла исходный вопрос — возможно, он устарел.');
    await store.clearSession(ownerUserId);
    return;
  }

  await vkApi.sendMessage({ userId: question.userId }, text.trim());
  await store.markQuestionAnswered(session.answeringQuestionId);
  await vkApi.sendMessage({ userId: ownerUserId }, 'Ответ отправлен!');
  await store.clearSession(ownerUserId);
}

// ---------- диспетчер апдейтов ----------

async function handleUpdate(update) {
  try {
    const userId = extractUserId(update);
    if (!userId) {
      console.warn('[bot] EVENT_01');
      return;
    }

    console.log('[bot] EVENT_02');

    const isOwner = config.adminChatIds.some((id) => String(userId) === String(id));
    // Customers use ordinary community messages. Do not reply or create sessions.
    if (!isOwner) return;

    if (update.update_type === 'message_created') {
      const cmdText = (extractMessageText(update) || '').trim().toLowerCase();
      if (['/start', 'начать', 'старт', 'меню'].includes(cmdText)) {
        await store.clearSession(userId);
        if (isOwner) return admin.sendMenu(userId);
        return sendGreeting(userId);
      }
    }

    if (update.update_type === 'bot_started') {
      if (isOwner) return admin.sendMenu(userId);
      return sendGreeting(userId);
    }

    if (update.update_type === 'message_callback') {
      const data = extractCallbackData(update);
      if (!data) {
        console.warn('[bot] EVENT_03');
        return;
      }

      if (isOwner && data.indexOf('answer:') === 0) return admin.sendMenu(userId);

      if (isOwner) {
        const ownerSession = await store.getSession(userId);
        const handled = await admin.handleCallback(userId, ownerSession, data);
        if (!handled) return sendOwnerNotice(userId);
        return;
      }

      if (data === 'consent:start') return proceedAfterConsent(userId);
    }

    let session = await store.getSession(userId);
    if (session.step === 'awaiting_answer') { await store.clearSession(userId); session = {}; }

    if (isOwner && session.step !== 'awaiting_answer') {
      if (update.update_type === 'message_created') {
        if (admin.isAdminStep(session.step)) return admin.handleMessage(update, userId, session);
        return sendOwnerNotice(userId);
      }
      return;
    }

    switch (session.step) {
      case 'awaiting_consent':
        if (update.update_type === 'message_created') return remindAboutConsent(userId);
        return;
      case 'awaiting_message':
        return handleAwaitingMessage(update, userId, session);
      case 'awaiting_phone':
        return handleAwaitingPhone(update, userId, session);
      case 'chatting':
        return handleChatting(update, userId, session);
      case 'awaiting_answer':
        return handleAwaitingAnswer(update, userId, session);
      default:
        if (update.update_type === 'message_created') return sendGreeting(userId);
    }
  } catch (err) {
    console.error('[bot] EVENT_04');
    throw err;
  }
}

module.exports = { handleUpdate };
