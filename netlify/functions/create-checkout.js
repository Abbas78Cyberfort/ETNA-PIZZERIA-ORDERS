
'use strict';
/**
 * netlify/functions/create-checkout.js
 * POST /.netlify/functions/create-checkout
 * Validates the cart (prices are checked against the server-side menu), then creates a Stripe Checkout
 * Session in SEK and returns { url }. The order is stored in the session metadata – NOTHING is sent
 * to Telegram here. That only happens in stripe-webhook.js after the payment is confirmed.
 */
const Stripe = require('stripe');
const { validateOrder, orderingOpenNow, orderingClosedMessage } = require('./lib/validate-order');
const { packOrder } = require('./lib/order-meta');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

// Customer's choice on the website -> payment methods shown on the Stripe page.
// Klarna is always offered together with card: Swedish rules require a direct payment option next to BNPL.
const PAYMENT_METHODS = {
  swish: ['swish'],
  card: ['card'],
  klarna: ['klarna', 'card']
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set');
    return json(500, { error: 'Betalningen är inte konfigurerad ännu. Ring oss på 018-20 35 60.' });
  }
  if ((event.body || '').length > 60000) return json(413, { error: 'Beställningen är för stor.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Ogiltig förfrågan.' }); }

  if (!orderingOpenNow()) return json(400, { error: orderingClosedMessage() });

  const result = validateOrder(body);
  if (!result.ok) return json(400, { error: result.error });
  const order = result.order;

  let metadata;
  try { metadata = packOrder(order); } catch (e) { return json(400, { error: e.message }); }

  const site = (process.env.SITE_URL || process.env.URL || `https://${event.headers.host}`).replace(/\/+$/, '');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'sv',
      payment_method_types: PAYMENT_METHODS[order.payChoice] || PAYMENT_METHODS.card,
      line_items: order.items.map((i) => ({
        quantity: i.qty,
        price_data: {
          currency: 'sek',
          unit_amount: i.unitPrice * 100,
          product_data: { name: i.name, ...(i.details ? { description: i.details } : {}) }
        }
      })),
      metadata,
      payment_intent_data: {
        description: `Etna Pizzeria – ${order.name}`,
        metadata: { etna: '1', customer_name: order.name, customer_phone: order.phone, order_type: order.type, total_sek: String(order.total) }
      },
      custom_text: { submit: { message: 'Din beställning skickas till restaurangen när betalningen är genomförd.' } },
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${site}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/?payment=cancel`
    });
    return json(200, { url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe error:', err && err.message);
    const msg = /payment method type/i.test(err && err.message || '')
      ? 'Det valda betalsättet är inte aktiverat ännu. Välj ett annat betalsätt eller ring oss på 018-20 35 60.'
      : 'Kunde inte starta betalningen just nu. Försök igen eller ring oss på 018-20 35 60.';
    return json(502, { error: msg });
  }
};
