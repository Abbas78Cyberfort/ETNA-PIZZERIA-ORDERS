'use strict';
/**
 * netlify/functions/stripe-webhook.js
 * POST /.netlify/functions/stripe-webhook   (register this URL in Stripe -> Developers -> Webhooks)
 *
 * 1. Verifies the Stripe signature (STRIPE_WEBHOOK_SECRET). Anything unsigned/forged is rejected with 400.
 * 2. ONLY when checkout.session.completed / async_payment_succeeded arrives with payment_status === 'paid':
 *      a) forwards the order to your existing order system (create-order -> Telegram message WITH the
 *         time buttons 10/15/20 min ..., order ID, live status for the customer),
 *      b) sends a short "BETALD" confirmation to Telegram (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID),
 *      c) stores the order ID on the Stripe PaymentIntent (used for de-duplication + the customer's status page).
 * 3. If step (a) fails (e.g. paid after closing time), a full plain-text "PAID ORDER – handle manually"
 *    message is sent straight to Telegram so a paid order is never lost.
 */
const Stripe = require('stripe');
const { unpackOrder } = require('./lib/order-meta');

const reply = (statusCode, body) => ({ statusCode, body });

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(6000)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.ok) throw new Error(`Telegram: ${d && d.description ? d.description : 'HTTP ' + r.status}`);
}

// Sends the paid order to the existing order system (same JSON the website used to send before Stripe).
async function forwardToOrderSystem(order, sessionId) {
  const secret = process.env.INTERNAL_ORDER_SECRET;
  const base = (process.env.SITE_URL || process.env.URL || '').replace(/\/+$/, '');
  if (!secret) throw new Error('INTERNAL_ORDER_SECRET is not set');
  if (!base) throw new Error('SITE_URL / URL is not set');
  const res = await fetch(`${base}/.netlify/functions/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret, 'x-payment-ref': sessionId },
    body: JSON.stringify({
      type: order.type,
      name: order.name,
      phone: order.phone,
      address: order.address,
      items: order.items,
      total: order.total
    }),
    signal: AbortSignal.timeout(6500)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.orderId) throw new Error(`create-order: ${data && data.error ? data.error : 'HTTP ' + res.status}`);
  return data;
}

function manualOrderText(order, session, payLabel, reason) {
  const lines = [
    '🚨 BETALD BESTÄLLNING – HANTERA MANUELLT',
    `⚠️ ${reason}`,
    `💳 Betald via ${payLabel} (Stripe ${session.id})`,
    '',
    `📦 Typ: ${order.type === 'pickup' ? 'Avhämtning' : 'Utkörning'}`,
    `👤 Namn: ${order.name}`,
    `📞 Telefon: ${order.phone}`
  ];
  if (order.address) lines.push(`📍 Adress: ${order.address}`);
  lines.push('', '🍽️ Varor:');
  order.items.forEach((i, n) => {
    lines.push(`${n + 1}. ${i.qty}x ${i.name} — ${i.unitPrice * i.qty}:-`);
    if (i.details) lines.push(`   (${i.details})`);
  });
  lines.push('', `💰 Totalt (betalt): ${order.total}:-`, '', 'Ring kunden och bekräfta tiden.');
  return lines.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, 'Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing');
    return reply(500, 'Not configured');
  }

  // --- 1. signature verification (needs the RAW body) ---
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('Invalid Stripe signature:', err.message);
    return reply(400, 'Invalid signature');
  }

  // --- 2. only paid checkout sessions ---
  if (stripeEvent.type !== 'checkout.session.completed' && stripeEvent.type !== 'checkout.session.async_payment_succeeded') {
    return reply(200, 'ignored');
  }
  const session = stripeEvent.data.object;
  if (!session.metadata || session.metadata.etna !== '1') return reply(200, 'not an Etna order');
  if (session.payment_status !== 'paid') return reply(200, 'not paid yet'); // async methods: wait for async_payment_succeeded

  try {
    const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] });
    const pm = pi.metadata || {};
    if (pm.etna_order_id || pm.etna_manual === '1') return reply(200, 'already processed'); // de-duplication

    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const payType = (charge && charge.payment_method_details && charge.payment_method_details.type) || session.metadata.pay_choice || 'okänt';
    const payLabel = { swish: 'Swish', klarna: 'Klarna', card: 'Kort' }[payType] || payType;

    const order = unpackOrder(session.metadata);
    const amountOk = typeof session.amount_total !== 'number' || session.amount_total === order.total * 100;

    let created = null;
    let failReason = '';
    if (!order.items.length || order.total <= 0) failReason = 'Orderdata saknas i betalningen.';
    else if (!amountOk) failReason = 'Betalt belopp stämmer inte med orderns summa.';
    else {
      try { created = await forwardToOrderSystem(order, session.id); }
      catch (e) { failReason = `Kunde inte skapa ordern automatiskt (${e.message}).`; console.error('forward failed:', e.message); }
    }

    if (created) {
      try {
        await stripe.paymentIntents.update(pi.id, { metadata: { etna_order_id: String(created.orderId) } });
      } catch (e) { console.error('Could not store order id on PaymentIntent:', e.message); }
      try {
        await telegram(`💳 BETALD via ${payLabel} — Order #${created.orderId} — ${order.total}:- (Stripe ${pi.id})`);
      } catch (e) { console.error('Paid-notice failed:', e.message); }
      return reply(200, 'order created');
    }

    // Fallback: never lose a paid order. If Telegram fails too -> 500 so Stripe retries the webhook.
    await telegram(manualOrderText(order, session, payLabel, failReason));
    try {
      await stripe.paymentIntents.update(pi.id, { metadata: { etna_manual: '1' } });
    } catch (e) { console.error('Could not flag manual order:', e.message); }
    return reply(200, 'manual alert sent');
  } catch (err) {
    console.error('Webhook processing failed:', err.message);
    return reply(500, 'Processing failed'); // Stripe will retry
  }
};
