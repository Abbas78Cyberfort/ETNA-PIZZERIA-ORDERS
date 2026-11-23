// GET /api/health  – open this in a browser to see exactly what is (not) set up. Shows no secrets.
import { getStoreApi } from './shared/store.mjs';
import { tg } from './shared/telegram.mjs';
import { orderingOpen } from './shared/hours.mjs';

export default async (req) => {
  const env = process.env;
  const r = {
    env: {
      TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHAT_ID: !!env.TELEGRAM_CHAT_ID,
      TELEGRAM_WEBHOOK_SECRET: !!env.TELEGRAM_WEBHOOK_SECRET
    },
    storage: { backend: env.UPSTASH_REDIS_REST_URL ? 'upstash' : 'netlify-blobs', ok: false },
    telegram: { bot: null, webhookUrl: null, webhookOk: false, pendingError: null },
    onlineOrderingOpenNow: orderingOpen(),
    problems: []
  };

  try {
    const st = await getStoreApi();
    await st.set('__health__', { t: Date.now() });
    r.storage.ok = !!(await st.get('__health__'));
    if (!r.storage.ok) r.problems.push('Lagringen svarar men sparar inte.');
  } catch (e) {
    r.storage.error = e.message;
    r.problems.push('Lagringen fungerar inte: ' + e.message +
      (/blobs/i.test(e.message) ? ' → paketet @netlify/blobs saknas: deploya via GitHub/CLI (npm install) eller använd Upstash-variablerna.' : ''));
  }

  if (r.env.TELEGRAM_BOT_TOKEN) {
    try {
      const me = await tg('getMe', {});
      r.telegram.bot = '@' + me.username;
      const info = await tg('getWebhookInfo', {});
      r.telegram.webhookUrl = info.url || null;
      r.telegram.pendingError = info.last_error_message || null;
      const expected = new URL(req.url).origin + '/api/telegram-webhook';
      r.telegram.webhookOk = info.url === expected;
      if (!r.telegram.webhookOk) r.problems.push(`Webhook är inte registrerad. Öppna /api/setup-webhook?key=DIN_HEMLIGHET (förväntad URL: ${expected}).`);
      if (info.last_error_message) r.problems.push('Telegram rapporterar webhook-fel: ' + info.last_error_message);
    } catch (e) {
      r.problems.push('Telegram-token fungerar inte: ' + e.message);
    }
  } else {
    r.problems.push('Miljövariabeln TELEGRAM_BOT_TOKEN saknas.');
  }
  if (!r.env.TELEGRAM_CHAT_ID) r.problems.push('Miljövariabeln TELEGRAM_CHAT_ID saknas.');
  if (!r.env.TELEGRAM_WEBHOOK_SECRET) r.problems.push('Miljövariabeln TELEGRAM_WEBHOOK_SECRET saknas.');

  r.status = r.problems.length === 0 ? 'ok' : 'PROBLEM';
  return new Response(JSON.stringify(r, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
};

export const config = { path: '/api/health' };
