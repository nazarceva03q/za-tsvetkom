// This helper only validates local configuration. Configure Callback API in the VK community UI.
const config = require('../src/config');
const required = ['VK_GROUP_TOKEN','VK_GROUP_ID','VK_CALLBACK_SECRET','VK_CONFIRMATION_TOKEN','VK_OWNER_ID','PUBLIC_SERVER_URL'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) { console.error('Заполните: ' + missing.join(', ')); process.exitCode = 1; }
else {
 console.log('В настройках сообщества ВК: Работа с API → Callback API.');
 console.log('URL: ' + config.publicServerUrl);
 console.log('Версия API: ' + config.apiVersion + '. Секрет должен совпадать с VK_CALLBACK_SECRET.');
 console.log('Подтвердите сервер и включите message_new и message_event. Затем напишите сообществу: Начать.');
}
