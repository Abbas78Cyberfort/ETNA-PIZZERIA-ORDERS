'use strict';
/**
 * netlify/functions/payment-status.js
 * GET /.netlify/functions/payment-status?session_id=cs_...
 * Used by the website after returning from Stripe (?payment=success). Tells the page whether the payment
 * is confirmed and, once the webhook has created the Telegram order, which order ID to follow.
 * The session id is an unguessable token that only the paying customer has.
 */
const Stripe = require('stripe');
const { unpackOrder } = require('./lib/order-meta');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Not configured' });

  const sid = (event.queryStringParameters && event.queryStringParameters.session_id) || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return json(400, { error: 'Invalid session' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sid, { expand: ['payment_intent'] });
  } catch (err) {
    return json(err && err.code === 'resource_missing' ? 404 : 502, { error: 'Session not found' });
  }
  if (!session.metadata || session.metadata.etna !== '1') return json(404, { error: 'Session not found' });

  const paid = session.payment_status === 'paid';
  const pm = (session.payment_intent && session.payment_intent.metadata) || {};
  let orderId = null;
  let status = 'pending';
  if (paid && pm.etna_order_id) orderId = pm.etna_order_id;
  else if (paid && pm.etna_manual === '1') { orderId = `S${sid.slice(-6).toUpperCase()}`; status = 'received'; }

  const o = unpackOrder(session.metadata);
  return json(200, {
    paid,
    sessionStatus: session.status,
    orderId,
    status,
    type: o.type,
    name: o.name,
    phone: o.phone,
    address: o.address,
    total: o.total,
    items: o.items.map((i) => ({ name: i.name, details: i.details, unitPrice: i.unitPrice, qty: i.qty }))
  });
};
