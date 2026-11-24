'use strict';
/**
 * netlify/functions/lib/order-meta.js
 * Stores / restores the order inside Stripe `metadata` (max 50 keys, 500 chars per value).
 * The items are packed as compact JSON and split into chunks: items_0, items_1, ...
 */
const CHUNK = 480;
const MAX_CHUNKS = 36;

function packOrder(order) {
  const compact = JSON.stringify(order.items.map((i) => ({ n: i.name, d: i.details, p: i.unitPrice, q: i.qty, c: i.cartId })));
  const chunks = [];
  for (let i = 0; i < compact.length; i += CHUNK) chunks.push(compact.slice(i, i + CHUNK));
  if (chunks.length > MAX_CHUNKS) throw new Error('Beställningen är för stor.');

  const meta = {
    etna: '1',
    order_type: order.type,
    customer_name: order.name,
    customer_phone: order.phone,
    customer_address: order.address || '',
    pay_choice: order.payChoice,
    total_sek: String(order.total),
    items_n: String(chunks.length)
  };
  chunks.forEach((c, i) => { meta[`items_${i}`] = c; });
  return meta;
}

function unpackOrder(meta) {
  meta = meta || {};
  const n = parseInt(meta.items_n || '0', 10);
  let json = '';
  for (let i = 0; i < n; i++) json += meta[`items_${i}`] || '';
  let items = [];
  try {
    items = JSON.parse(json || '[]').map((x) => ({ cartId: x.c, name: x.n, details: x.d || '', unitPrice: x.p, qty: x.q }));
  } catch (e) { items = []; }
  return {
    type: meta.order_type === 'delivery' ? 'delivery' : 'pickup',
    name: meta.customer_name || '',
    phone: meta.customer_phone || '',
    address: meta.customer_address || '',
    payChoice: meta.pay_choice || '',
    total: parseInt(meta.total_sek || '0', 10),
    items
  };
}

module.exports = { packOrder, unpackOrder };
