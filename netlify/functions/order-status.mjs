// GET /api/order-status?id=ABC123  – polled by the customer's phone/computer every 4 seconds
import { getStoreApi } from './shared/store.mjs';
import { ID_RE } from './shared/telegram.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });

export default async (req) => {
  const id = (new URL(req.url).searchParams.get('id') || '').toUpperCase();
  if (!ID_RE.test(id)) return json({ error: 'Ogiltigt order-ID' }, 400);
  const rec = await (await getStoreApi()).get(id);
  if (!rec) return json({ error: 'Order hittades inte' }, 404);
  // Only non-personal fields are returned
  return json({
    orderId: rec.id,
    status: rec.status,            // pending | confirmed | rejected | failed
    minutes: rec.minutes,          // e.g. 25 (only when confirmed)
    confirmedAt: rec.confirmedAt   // ms timestamp from the server
  });
};

export const config = { path: '/api/order-status' };
