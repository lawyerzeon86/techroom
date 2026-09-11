import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const ADMIN_COOKIE = 'techroom_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type RateEntry = { count: number; resetAt: number };
const rateStore = new Map<string, RateEntry>();

function safeEqual(a: string, b: string) {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

function sessionSecret() {
  const explicit = process.env.ADMIN_SESSION_SECRET;
  if (explicit && explicit.length >= 32) return explicit;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return createHash('sha256').update(`techroom-session:${password}`).digest('hex');
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAdminSessionCookie() {
  const secret = sessionSecret();
  if (!secret) throw new Error('Admin authentication is not configured');
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const nonce = randomBytes(16).toString('base64url');
  const payload = `${expires}.${nonce}`;
  const token = `${payload}.${sign(payload, secret)}`;
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearAdminSessionCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function isAdminSession(request: Request) {
  const token = getCookie(request, ADMIN_COOKIE);
  const secret = sessionSecret();
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expRaw, nonce, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || nonce.length < 8) return false;
  const payload = `${expRaw}.${nonce}`;
  return safeEqual(sig, sign(payload, secret));
}

export function verifyAdminPassword(candidate: string) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured || configured.length < 12) return false;
  return safeEqual(candidate, configured);
}

function clientKey(request: Request, bucket: string) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  return `${bucket}:${forwarded || real || 'unknown'}`;
}

export function rateLimit(request: Request, bucket: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = clientKey(request, bucket);
  const current = rateStore.get(key);
  if (!current || current.resetAt <= now) {
    rateStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

export async function readJsonBody(request: Request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error('INVALID_JSON');
  }
}

const CATEGORIES = ['Автозапчасти', 'Электроника', 'Гаджеты', '3D-печать'] as const;

function cleanText(value: unknown, max: number, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error('VALIDATION');
  if (text.length > max) throw new Error('VALIDATION');
  return text || null;
}

function finiteNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) throw new Error('VALIDATION');
  return n;
}

export function validateProduct(body: any) {
  const title = cleanText(body?.title, 200, true)!;
  const category = typeof body?.category === 'string' && CATEGORIES.includes(body.category as any) ? body.category : null;
  if (!category) throw new Error('VALIDATION');
  const imageUrlRaw = cleanText(body?.imageUrl, 1000);
  let imageUrl: string | null = null;
  if (imageUrlRaw) {
    let url: URL;
    try { url = new URL(imageUrlRaw); } catch { throw new Error('VALIDATION'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('VALIDATION');
    imageUrl = url.toString();
  }
  const oldPrice = body?.oldPrice === null || body?.oldPrice === '' || body?.oldPrice === undefined
    ? null
    : Math.round(finiteNumber(body.oldPrice, 0, 100_000_000, 0));
  return {
    category,
    title,
    price: Math.round(finiteNumber(body?.price, 0, 100_000_000, 0)),
    oldPrice,
    rating: Math.round(finiteNumber(body?.rating, 0, 5, 5) * 10) / 10,
    reviews: Math.round(finiteNumber(body?.reviews, 0, 10_000_000, 0)),
    badge: cleanText(body?.badge, 40),
    emoji: cleanText(body?.emoji, 16) || '📦',
    imageUrl,
    sku: cleanText(body?.sku, 100),
    oem: cleanText(body?.oem, 100),
    stock: Math.round(finiteNumber(body?.stock, 0, 10_000_000, 0)),
    description: cleanText(body?.description, 5000),
    specs: cleanText(body?.specs, 10000),
    isActive: body?.isActive !== false,
    sortOrder: Math.round(finiteNumber(body?.sortOrder, -1_000_000, 1_000_000, 0)),
  };
}

export function parseProductId(raw: string) {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
