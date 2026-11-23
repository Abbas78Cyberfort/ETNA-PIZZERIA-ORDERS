// GET /api/setup-webhook?key=<TELEGRAM_WEBHOOK_SECRET>
// One-time helper: registers https://<your-site>/api/telegram-webhook as the bot's webhook.
import { tg } from './shared/telegram.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || url.searchParams.get('key') !== secret) return new Response('Unauthorized', { status: 401 });
  try {
    const hook = `${url.origin}/api/telegram-webhook`;
    await tg('setWebhook', {
      url: hook,
      secret_token: secret,
      allowed_updates: ['callback_query'],
      drop_pending_updates: true
    });
    const info = await tg('getWebhookInfo', {});
    return new Response(JSON.stringify({ ok: true, webhook: hook, info }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/setup-webhook' };
