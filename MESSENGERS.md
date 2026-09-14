# WhatsApp и MAX для TechRoom

Оба канала используют существующий каталог, остатки и таблицы заказов TechRoom. Секреты задаются только в Render Environment.

## MAX

- Mini App: `https://techroom-main.onrender.com/max`
- Webhook: `https://techroom-main.onrender.com/api/max/webhook`
- API использует актуальный домен `https://platform-api2.max.ru`.
- Переменные: `MAX_BOT_TOKEN`, `MAX_WEBAPP_URL`, `MAX_WEBHOOK_SECRET`, необязательные `MAX_ADMIN_USER_ID` и `NEXT_PUBLIC_MAX_MANAGER_URL`.

В платформе MAX добавьте URL Mini App к боту. Webhook оформляется подпиской `POST /subscriptions` на события `bot_started` и `message_created`; значение `secret` должно совпадать с `MAX_WEBHOOK_SECRET`. Сервер проверяет заголовок `X-Max-Bot-Api-Secret`.

Mini App передаёт `window.WebApp.initData`. Backend проверяет HMAC-SHA256 и срок действия, а пользователя извлекает только из подписанных данных. Переданный клиентом `user_id` не используется.

## WhatsApp Business Cloud API

- Callback URL: `https://techroom-main.onrender.com/api/whatsapp/webhook`
- Verify token: значение `WHATSAPP_VERIFY_TOKEN`.
- Подпись POST-запросов проверяется через `WHATSAPP_APP_SECRET` и `X-Hub-Signature-256`.
- Переменные: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, необязательные `WHATSAPP_GRAPH_VERSION` и `WHATSAPP_STORE_URL`.

Сообщения «магазин» и «каталог» возвращают кнопку мобильной витрины. Сообщение с номером заказа `TR-…` показывает статус только при совпадении номера телефона WhatsApp с телефоном заказа.

После добавления приложения в Meta Developer Dashboard подпишите webhook на поле `messages`. Для исходящих сообщений вне разрешённого пользовательского окна потребуются одобренные Meta шаблоны; текущий сценарий отвечает на входящие сообщения.
