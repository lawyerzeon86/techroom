# Перенос TechRoom с Render на REG.RU

## Важное ограничение текущего тарифа

Тариф REG.RU `Host-0` не запускает постоянные Node.js-процессы и предоставляет
обычную панель PHP/MySQL. TechRoom использует Next.js 16, серверные API и
PostgreSQL, поэтому рабочий магазин необходимо размещать на VPS/облачном
сервере REG.RU. Статическая выгрузка на `Host-0` отключит корзину, заказы,
админку, ботов и интеграции маркетплейсов.

## Что переносит агент

- репозиторий `lawyerzeon86/techroom`;
- PostgreSQL целиком через согласованный `pg_dump`;
- товары, заказы, позиции заказов и заказы маркетплейсов с проверкой количества;
- переменные приложения и интеграций;
- Node.js 22, systemd, Nginx и HTTPS;
- Telegram webhook на `https://duisun.ru/api/telegram/webhook`;
- основной домен `duisun.ru` и `www`.

## Безопасная последовательность

1. Заказать VPS REG.RU: Ubuntu 24.04, минимум 2 vCPU, 2 ГБ RAM и 25 ГБ SSD.
2. Скопировать `scripts/regru-migration.env.example` в
   `/root/techroom-migration.env` и заполнить секреты.
3. В Render временно разрешить публичный IP нового VPS для базы
   `techroom-db`, затем указать External Database URL как
   `SOURCE_DATABASE_URL`.
4. Запустить безопасную проверку:

   ```bash
   MIGRATION_CONFIG=/root/techroom-migration.env npm run migration:regru -- preflight
   ```

5. Выполнить перенос и локальную проверку:

   ```bash
   MIGRATION_CONFIG=/root/techroom-migration.env npm run migration:regru -- install
   ```

6. Только после сообщения `cutover-ready` изменить A-записи `@` и `www` на IP
   VPS. До этого сайт на Render продолжает принимать заказы.
7. После распространения DNS выполнить:

   ```bash
   MIGRATION_CONFIG=/root/techroom-migration.env npm run migration:regru -- finalize
   ```

8. Render оставить включённым минимум на 48 часов. После повторной проверки
   заказов и интеграций удалить временное правило доступа к Render PostgreSQL.

Агент не удаляет сервисы или базу Render и не переключает DNS, пока локальные
проверки и сравнение данных не завершены успешно.
