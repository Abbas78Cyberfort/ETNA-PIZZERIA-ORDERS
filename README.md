# Etna Pizzeria – order ID, Telegram time buttons & live order status

## What is in this folder
```
index.html                              the website (menu/prices/design unchanged)
netlify.toml                            Netlify settings
package.json                            dependency: @netlify/blobs (order storage)
netlify/functions/create-order.mjs      POST /api/create-order      (website -> creates unique order ID -> Telegram)
netlify/functions/order-status.mjs      GET  /api/order-status?id=  (customer screen polls this every 4 s)
netlify/functions/telegram-webhook.mjs  POST /api/telegram-webhook  (Telegram -> button taps)
netlify/functions/setup-webhook.mjs     GET  /api/setup-webhook?key=SECRET  (one-time webhook registration)
netlify/functions/health.mjs            GET  /api/health            (diagnosis: shows exactly what is missing)
netlify/functions/shared/*.mjs          storage + Telegram helpers
```

## How it works (data flow)
1. Customer presses "Skicka beställning online" -> browser POSTs the order to `/api/create-order`.
2. The function creates a unique 6-character order ID (e.g. `XPZ2PQ`), saves the order as `pending` in storage and sends it to the Telegram group with `sendMessage` + an inline keyboard (10/15/20/25/30/35/40/45 min + "Avvisa"). Normal Telegram sound/notification.
3. The customer's screen shows "Väntar på bekräftelse…" with the order ID and polls `/api/order-status?id=XPZ2PQ` every 4 s. It never shows a time while the status is `pending`.
4. Staff tap e.g. "25 min". Telegram sends a `callback_query` (callback_data = `t:XPZ2PQ:25`) to `/api/telegram-webhook`.
5. The webhook checks the secret header + that the tap came from your own group, writes `status=confirmed, minutes=25, confirmedAt=now` to the SAME storage record, answers the button (popup in Telegram) and edits the Telegram message to "✅ BEKRÄFTAD — Tid: 25 min" with the chosen button marked ✅.
6. The customer's next poll (≤ 4 s) reads the record -> screen switches to "Beställningen är bekräftad! Bekräftad tid: 25 min" (+ approx. clock time), the cart drawer opens, a toast shows and the phone vibrates.
   The shared storage record is what connects Telegram and the customer's screen.
7. "Avvisa" sets `status=rejected` -> customer sees that the order could not be accepted + the phone number.
   Tapping another time later changes the confirmed time (customer screen updates again) – useful if someone taps wrong.
The order also survives a page reload (kept in the browser's localStorage for 3 h).

## Environment variables (Netlify -> Site configuration -> Environment variables)
| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the bot token from @BotFather (use a NEW one – see security note) |
| `TELEGRAM_CHAT_ID` | `-1004366975815` (your group/chat id) |
| `TELEGRAM_WEBHOOK_SECRET` | any long random string, letters/numbers/`_`/`-` only (e.g. `etna_9fK2xQ7vLm4Rt8Zc`) |
Optional (instead of Netlify Blobs): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (free Upstash Redis – works even with plain drag-and-drop deploys).

## Setup steps
1. **New bot token (important):** the old token was visible in the website code. In Telegram open @BotFather -> `/revoke` (or `/token`) for your bot and use the new token below. Make sure the bot is a member of the order group.
2. **Deploy this whole folder** (not only index.html). Netlify Functions need to be deployed with the site:
   - Recommended: put the folder in a GitHub repo and connect it in Netlify (Add new site -> Import from Git). Netlify installs `@netlify/blobs` automatically.
   - Or with the CLI: `npm i -g netlify-cli`, then in this folder `npm install` and `netlify deploy --prod`.
   - Plain drag-and-drop of only `index.html` will NOT work (no functions). If you drag-and-drop the whole folder, use the Upstash variables above because drag-and-drop does not install npm packages.
3. Add the three environment variables, then **redeploy** (Deploys -> Trigger deploy).
4. **Register the Telegram webhook once:** open in a browser
   `https://YOUR-SITE.netlify.app/api/setup-webhook?key=YOUR_TELEGRAM_WEBHOOK_SECRET`
   You should see `"ok": true` and the webhook URL. (Equivalent curl:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://YOUR-SITE.netlify.app/api/telegram-webhook -d secret_token=<SECRET> -d 'allowed_updates=["callback_query"]'`)
   Note: a bot with a webhook cannot also be polled with getUpdates by another program.
5. **Test:** place an order on the site -> it appears in Telegram with buttons -> tap "25 min" -> customer screen shows "Bekräftad tid: 25 min" within ~4 s.

## Security notes
- The bot token is now only on the server (environment variable), no longer in `index.html`.
- The webhook only accepts requests carrying your secret header and only taps from `TELEGRAM_CHAT_ID`.
- `/api/order-status` returns only status/minutes (no name, phone or address).
- Order IDs are random (not guessable counters).

## Rules built in
- The customer does NOT choose a time. Only staff choose 10/15/20/25/30/35/40/45 min in Telegram.
- Online orders are accepted 11:00–20:45 (Stockholm time, summer/winter handled). At 20:46 the button is disabled and the server also refuses (HTTP 403). The shown opening hours (11:00–21:00) are unchanged.

## "My order does not go through" – checklist
1. Open `https://YOUR-SITE.netlify.app/api/health`.
   - Page not found / "Page Not Found" -> the functions were not deployed (only index.html was uploaded). Deploy the whole folder (GitHub or `netlify deploy --prod`).
   - `"problems"` lists exactly what is missing (env variable, webhook, storage).
2. Netlify -> Site -> Functions: you should see create-order, order-status, telegram-webhook, setup-webhook, health.
3. Environment variables set (3 required) and the site redeployed afterwards.
4. Webhook registered via `/api/setup-webhook?key=SECRET`.
Safety net: if the functions are not reachable the page sends the order straight to Telegram (without time buttons, marked "manuell") so no order is lost. The customer then sees "Tack för din beställning" (no live time). To remove the safety net once everything works, empty `FALLBACK_TELEGRAM` in index.html and revoke the old token.  
