# Telegram-магазин TechRoom

Mini App расположен по адресу `/telegram` и использует ту же таблицу `products` и те же остатки, что основной сайт. Заказы сохраняются в существующие `orders` и `order_items`.

## Настройка без секретов в репозитории

Переменные задаются только в Render Environment:

- `TELEGRAM_BOT_TOKEN` — токен от BotFather;
- `TELEGRAM_WEBAPP_URL` — `https://techroom-main.onrender.com/telegram`;
- `TELEGRAM_WEBHOOK_SECRET` — случайная строка для проверки webhook;
- `TELEGRAM_ADMIN_CHAT_ID` — необязательно, чат уведомлений о новых заказах;
- `NEXT_PUBLIC_TELEGRAM_MANAGER_URL` — ссылка вида `https://t.me/username`.

После деплоя webhook устанавливается один раз запросом к Telegram Bot API с URL `https://techroom-main.onrender.com/api/telegram/webhook` и тем же `secret_token`, который записан в `TELEGRAM_WEBHOOK_SECRET`. Реальные значения нельзя добавлять в команды, логи или Git.

Команды `/start` и `/shop` показывают кнопку магазина. В BotFather для бота также можно назначить Menu Button на `TELEGRAM_WEBAPP_URL`.

## Безопасность

Каждый запрос Mini App передаёт исходный Telegram `initData`. Сервер независимо проверяет HMAC-подпись, срок авторизации и извлекает пользователя только из подписанного значения. `user_id` из тела запроса не принимается. Каталог, оформление и история заказов имеют rate limiting. Webhook принимает запросы только с корректным секретным заголовком Telegram.

Оплата вынесена как выбираемый способ. До подключения Telegram Payments сохраняются QR/СБП и оплата при получении; платёжные реквизиты в коде не хранятся.
