# Прочитанный текущий код bot/ — без изменений и запуска

Это дополнение к прошлому отчёту: локальные файлы теперь доступны.
Проверены структура папки и ключевые модули. Полная интеграция отложена.

- index.js использует src/vkWebhook.js и src/notify.js, package.json называется
  za-tsvetkom-vk-bot. Это VK-код, а не вывод по названию ZIP.
- vkWebhook.handle() проверяет group_id и secret до обработки событий.
  normalize() ограничивает поддерживаемые события личными входящими сообщениями.
- bot.handleUpdate() проверяет config.adminChatIds и передаёт администратора
  в admin.handleCallback()/handleMessage(). Но покупательские сценарии тоже есть:
  sendGreeting(), handleAwaitingMessage(), handleAwaitingPhone(), handleChatting(),
  forwardToOwner(), startAnswerFlow(), handleAwaitingAnswer(). Они пока не отключены.
- products.getCatalog()/saveCatalog() используют catalog.json в публичном
  Object Storage; uploadPhoto() загружает туда фото. MySQL здесь не используется.
- store.saveLead()/getLeadsPage() используют JSON, лимит последних заявок — 500.
  Другие JSON хранят сессии, вопросы и сведения о повторных обращениях.
- notify.sendLeadNotification() сначала сохраняет JSON-заявку и затем сразу
  вызывает VK API. Устойчивой SQL-очереди и cron-отправщика в этой цепочке нет.
- config.siteBaseUrl по умолчанию всё ещё указывает на GitHub Pages.
- В products.js и store.js остались комментарии Max.
- Внешний обработчик index.execute() принимает payload с phone без отдельного
  API-ключа и вызывает уведомление; есть широкий CORS. Не использовать его как
  надёжный обработчик заказов сайта.
- vkWebhook.handle() делает hasProcessedEvent -> обработка -> markProcessedEvent.
  Это не единая атомарная операция для нескольких экземпляров Cloud Functions;
  локальная Promise-очередь index.js не устраняет распределённую гонку.

На этапе 1 никакие вызовы бота не используются. Для последующей интеграции нужно
отдельно проверить все административные сценарии, конкурентные записи Object
Storage и ограничение обработки сообщений только администраторами.
Файлы bot/ зафиксированы контрольными суммами и оставлены без изменений.
