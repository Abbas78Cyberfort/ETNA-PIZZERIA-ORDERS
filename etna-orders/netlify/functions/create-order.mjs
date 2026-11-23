// POST /api/create-order
// Called by the website when the customer presses "Skicka beställning online".
// Creates a unique order ID, stores the order as "pending" and posts it to Telegram with time buttons.
import { getStoreApi } from './shared/store.mjs';
import { tg, formatOrderText, buildKeyboard } from './shared/telegram.mjs';
import { orderingOpen, closedMessage } from './shared/hours.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function sanitize(body) {
  if (!body || typeof body !== 'object') return null;
  const type = body.type === 'delivery' ? 'delivery' : 'pickup';
  const name = str(body.name, 80);
  const phone = str(body.phone, 30);
  const address = str(body.address, 160);
  if (!name || !phone) return null;
  if (type === 'delivery' && !address) return null;
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 60) return null;
  const items = body.items.map((i) => ({
    name: str(i.name, 120),
    qty: Math.min(99, Math.max(1, parseInt(i.qty, 10) || 1)),
    unitPrice: Math.max(0, Math.round(Number(i.unitPrice) || 0)),
    details: str(i.details, 300)
  }));
  if (items.some((i) => !i.name)) return null;
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  return { type, name, phone, address, items, total };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return json({ error: 'Servern saknar TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID' }, 500);
  }

  if (!orderingOpen()) return json({ error: closedMessage(), code: 'closed' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Ogiltig begäran' }, 400); }
  const order = sanitize(body);
  if (!order) return json({ error: 'Ogiltig beställning (kontrollera namn, telefon och varor)' }, 400);

  let store;
  try {
    store = await getStoreApi();
    await store.get('__ping__');
  } catch (err) {
    console.error('storage error:', err);
    return json({ error: `Lagringen fungerar inte (${err.message}). Öppna /api/health för diagnos.`, code: 'storage' }, 500);
  }

  let id = '';
  for (let i = 0; i < 8; i++) {
    const candidate = newId();
    if (!(await store.get(candidate))) { id = candidate; break; }
  }
  if (!id) return json({ error: 'Kunde inte skapa order-ID' }, 500);

  const record = {
    id,
    status: 'pending',
    minutes: null,
    createdAt: Date.now(),
    confirmedAt: null,
    confirmedBy: null,
    telegram: null,
    order
  };
  await store.set(id, record);

  try {
    const msg = await tg('sendMessage', {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: formatOrderText(record),
      reply_markup: buildKeyboard(record),
      disable_notification: false // normal sound / notification
    });
    record.telegram = { chat_id: msg.chat.id, message_id: msg.message_id };
    await store.set(id, record);
  } catch (err) {
    record.status = 'failed';
    await store.set(id, record).catch(() => {});
    return json({ error: `Kunde inte skicka till Telegram (${err.message})` }, 502);
  }

  return json({ orderId: id, status: 'pending' });
};

export const config = { path: '/api/create-order' };
