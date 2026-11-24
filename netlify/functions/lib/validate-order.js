'use strict';
/**
 * netlify/functions/lib/validate-order.js
 * Server-side validation of the cart. NEVER trust prices coming from the browser:
 * every line's unit price must be one the menu can actually produce (see menu-catalog.json).
 */
const catalog = require('./menu-catalog.json');

const OPEN_MIN = 11 * 60;          // 11:00
const LAST_MIN = 20 * 60 + 45;     // 20:45 (same as the website)

function stockholmMinutes() {
  let h = 0, m = 0;
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).forEach((p) => {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    });
  return h * 60 + m;
}
const orderingOpenNow = () => { const t = stockholmMinutes(); return t >= OPEN_MIN && t <= LAST_MIN; };
const orderingClosedMessage = () => (stockholmMinutes() < OPEN_MIN
  ? 'Onlinebeställning öppnar kl 11:00. Du kan ringa oss på 018-20 35 60.'
  : 'Onlinebeställning är stängd (sista beställning kl 20:45). Ring oss på 018-20 35 60.');

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function subsetSums(values) {
  let sums = new Set([0]);
  for (const v of values) {
    const next = new Set(sums);
    sums.forEach((s) => next.add(s + v));
    sums = next;
  }
  return sums;
}

const priceCache = new Map();
function allowedPrices(itemId, variantIdx) {
  const key = `${itemId}:${variantIdx}`;
  if (priceCache.has(key)) return priceCache.get(key);
  const item = catalog.items[itemId];
  const base = item.prices[variantIdx];
  const addons = catalog.addons[item.type] || [];
  const plain = addons.filter((a) => !a.replaceBase).map((a) => a.price);
  const repl = addons.filter((a) => a.replaceBase).map((a) => a.price);
  const sums = subsetSums(plain);
  const set = new Set();
  [base, ...repl].forEach((b) => sums.forEach((s) => set.add(Math.max(0, b + s))));
  priceCache.set(key, set);
  return set;
}

// cartId formats produced by index.html:  "p5"  |  "k1-v0"  |  "p5-0-<details>"
function parseCartId(cartId) {
  const parts = String(cartId || '').split('-');
  const id = parts[0];
  let idx = 0;
  if (parts[1]) {
    const m = /^v?(\d+)$/.exec(parts[1]);
    if (m) idx = parseInt(m[1], 10);
  }
  return { id, idx };
}

function validateOrder(body, opts = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!body || typeof body !== 'object') return fail('Ogiltig beställning.');

  const deliveryEnabled = process.env.ETNA_DELIVERY_ENABLED === '1';
  const type = body.type === 'delivery' && deliveryEnabled ? 'delivery' : 'pickup';

  const name = clean(body.name, 60);
  const phone = clean(body.phone, 25);
  const address = type === 'delivery' ? clean(body.address, 200) : '';
  if (!name) return fail('Namn saknas.');
  if (!/^[+0-9][0-9 ()\-+]{6,24}$/.test(phone)) return fail('Ogiltigt telefonnummer.');
  if (type === 'delivery' && !address) return fail('Leveransadress saknas.');

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return fail('Varukorgen är tom eller för stor.');

  const items = [];
  let total = 0;
  for (const raw of body.items) {
    const { id, idx } = parseCartId(raw && raw.cartId);
    const item = catalog.items[id];
    if (!item) return fail('En av rätterna finns inte längre i menyn. Ladda om sidan och försök igen.');
    if (!Number.isInteger(idx) || idx < 0 || idx >= item.prices.length) return fail('Ogiltigt utförande på en rätt.');

    const qty = Number(raw.qty);
    const unitPrice = Number(raw.unitPrice);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail('Ogiltigt antal.');
    if (!Number.isInteger(unitPrice) || !allowedPrices(id, idx).has(unitPrice)) {
      return fail('Priset på en rätt stämmer inte med menyn. Ladda om sidan och försök igen.');
    }

    // Display name is rebuilt from the server catalog (never from the browser)
    let displayName = item.num ? `${item.num}. ${item.name}` : item.name;
    if (item.variants) displayName += ` (${String(item.variants[idx]).split(' ')[0]})`;

    items.push({ cartId: id, name: displayName, details: clean(raw.details, 200), unitPrice, qty });
    total += unitPrice * qty;
  }

  const max = parseInt(process.env.MAX_ORDER_SEK || '3000', 10);
  if (total < 10) return fail('Beställningens värde är för lågt.');
  if (total > max) return fail(`Beställningar över ${max}:- tas emot via telefon. Ring oss på 018-20 35 60.`);

  const pay = ['swish', 'klarna', 'card'].includes(body.paymentMethod) ? body.paymentMethod : 'card';
  return { ok: true, order: { type, name, phone, address, items, total, payChoice: pay } };
}

module.exports = { validateOrder, orderingOpenNow, orderingClosedMessage };
