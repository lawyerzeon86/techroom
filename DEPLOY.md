# TechRoom — Selectel

Production: https://duisun.ru. PostgreSQL работает локально на сервере, приложение управляется PM2, HTTPS — nginx.

Push в main запускает `.github/workflows/deploy-isp.yml` (Deploy to Selectel). Ключ SSH хранится в GitHub Secrets, DATABASE_URL — в `/root/duisun-db.env`, настройки администратора — `/root/duisun-admin.env`, интеграций — `/root/duisun-integrations.env`. Права файлов: 600. После изменения интеграций нужен деплой.

Каталог состоит из реальных товаров Ozon и Wildberries; демотовары не создаются. Управление: `/admin`, заказы: `/admin/orders`, WhatsApp: `/admin/whatsapp`.

Синхронизации запускаются systemd timers, резервная копия PostgreSQL — ежедневно. Копии находятся в `/root/duisun-backups`; полный снимок прежнего хранилища и отчёт сверки — `/root/duisun-migration`. Это архив, приложение не обращается к прежнему хостингу.

Для СБП нужны YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY. Webhook ЮKassa: `https://duisun.ru/api/payments/yookassa/webhook`. Возврат: `https://duisun.ru/payment/return`. Без ключей сайт предлагает оплату при получении.

Email: SMTP_HOST, SMTP_PORT (587/465), SMTP_USER, SMTP_PASSWORD (или SMTP_PASS), EMAIL_FROM (или SMTP_FROM). Письма заказов отправляются защищённой серверной очередью каждые 5 минут. Для 587 требуется STARTTLS. Без настроек письма не отправляются.

Telegram использует очередь повторной доставки и GitHub runner при недоступности API с сервера. WhatsApp требует WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET и WHATSAPP_VERIFY_TOKEN.
