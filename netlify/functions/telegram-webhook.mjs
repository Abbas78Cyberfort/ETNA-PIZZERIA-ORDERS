// POST /api/telegram-webhook  – Telegram calls this when someone taps a button under an order.
import { getStoreApi } from './shared/store.mjs';
import { tg, formatOrderText, buildKeyboard, TIMES, ID_RE } from './shared/telegram.mjs';

const ok = () => new Response('ok', { status: 200 }); // always 200 so Telegram does not retry endlessly

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // 1) Only Telegram (who knows the secret) may call this endpoint
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try { update = await req.json(); } catch { return ok(); }
  const cb = update && update.callback_query;
  if (!cb) return ok();

  const answer = (text, alert = false) =>
    tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert }).catch(() => {});

  try {
    // 2) Only taps inside the restaurant's own Telegram group/chat count
    const chatId = cb.message && cb.message.chat && cb.message.chat.id;
    if (String(chatId) !== String(process.env.TELEGRAM_CHAT_ID)) {
      await answer('Ej behörig.', true);
      return ok();
    }

    const data = String(cb.data || '');
    let m = data.match(/^t:([A-HJ-NP-Z2-9]{6}):(\d{2})$/);
    let id, minutes = null, reject = false;
    if (m && ID_RE.test(m[1]) && TIMES.includes(Number(m[2]))) {
      id = m[1]; minutes = Number(m[2]);
    } else if ((m = data.match(/^r:([A-HJ-NP-Z2-9]{6})$/))) {
      id = m[1]; reject = true;
    } else {
      await answer('Okänd knapp.');
      return ok();
    }

    const store = await getStoreApi();
    const rec = await store.get(id);
    if (!rec) { await answer('Ordern hittades inte.', true); return ok(); }

    const who = cb.from ? (cb.from.username ? '@' + cb.from.username : cb.from.first_name || '') : '';

    if (reject) {
      if (rec.status === 'rejected') { await answer('Redan avvisad.'); return ok(); }
      rec.status = 'rejected'; rec.minutes = null;
    } else {
      if (rec.status === 'confirmed' && rec.minutes === minutes) { await answer(`Redan bekräftad: ${minutes} min`); return ok(); }
      rec.status = 'confirmed'; rec.minutes = minutes;
    }
    rec.confirmedAt = Date.now();
    rec.confirmedBy = who;
    await store.set(id, rec);   // <- the customer's next poll sees this

    await answer(reject ? `Order #${id} avvisad` : `Order #${id} bekräftad: ${minutes} min`);

    // 3) Update the Telegram message so everyone sees what was chosen
    const target = rec.telegram || { chat_id: chatId, message_id: cb.message.message_id };
    try {
      await tg('editMessageText', {
        chat_id: target.chat_id,
        message_id: target.message_id,
        text: formatOrderText(rec),
        reply_markup: buildKeyboard(rec)
      });
    } catch (e) {
      if (!/not modified/i.test(e.message)) console.error('editMessageText failed:', e.message);
    }
  } catch (err) {
    console.error('webhook error:', err);
    await answer('Fel – försök igen.', true);
  }
  return ok();
};

export const config = { path: '/api/telegram-webhook' };
