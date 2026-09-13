import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

export function verifyTelegramInitData(raw: string | null, maxAgeSeconds = 86400): TelegramUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !raw || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  const suppliedHash = params.get('hash');
  if (!suppliedHash || !/^[a-f\d]{64}$/i.test(suppliedHash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const supplied = Buffer.from(suppliedHash, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > maxAgeSeconds) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return user as TelegramUser;
  } catch { return null; }
}

export function telegramUserFromRequest(request: Request) {
  return verifyTelegramInitData(request.headers.get('x-telegram-init-data'));
}

export async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup }),
  });
  return response.ok;
}

export function escapeTelegram(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
