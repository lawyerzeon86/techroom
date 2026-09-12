'use client';

export type CartEntry = { productId: number; quantity: number };

const KEY = 'techroom_cart_v1';
const EVENT = 'techroom-cart-change';

function normalize(raw: unknown): CartEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CartEntry[] = [];
  for (const item of raw) {
    const productId = Number((item as any)?.productId);
    const quantity = Math.max(1, Math.min(99, Math.round(Number((item as any)?.quantity) || 1)));
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    const existing = out.find(x => x.productId === productId);
    if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
    else out.push({ productId, quantity });
  }
  return out;
}

export function loadCart(): CartEntry[] {
  if (typeof window === 'undefined') return [];
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || '[]')); }
  catch { return []; }
}

export function saveCart(items: CartEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(normalize(items)));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function addToCart(productId: number, quantity = 1) {
  const items = loadCart();
  const existing = items.find(x => x.productId === productId);
  if (existing) existing.quantity = Math.min(99, existing.quantity + Math.max(1, Math.round(quantity)));
  else items.push({ productId, quantity: Math.max(1, Math.min(99, Math.round(quantity))) });
  saveCart(items);
  return items;
}

export function setCartQuantity(productId: number, quantity: number) {
  const items = loadCart();
  const q = Math.max(0, Math.min(99, Math.round(quantity)));
  const next = q === 0 ? items.filter(x => x.productId !== productId) : items.map(x => x.productId === productId ? {...x, quantity:q} : x);
  saveCart(next);
  return next;
}

export function removeFromCart(productId: number) {
  const next = loadCart().filter(x => x.productId !== productId);
  saveCart(next);
  return next;
}

export function clearCart() { saveCart([]); }
export function cartCount(items = loadCart()) { return items.reduce((sum,x)=>sum+x.quantity,0); }
export const CART_EVENT = EVENT;
