// Telegram helpers + message formatting (runs only on the server – the bot token never reaches the browser)
export const TIMES = [10, 15, 20, 25, 30, 35, 40, 45];
export const ID_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function api(method) {
  const base = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
  return `${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

export async function tg(method, payload) {
  const r = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.ok) {
    const err = new Error(d && d.description ? d.description : `Telegram HTTP ${r.status}`);
    err.description = d && d.description;
    throw err;
  }
  return d.result;
}

function stockholmClock(ts) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(ts));
}

export function statusLine(order) {
  if (order.status === 'confirmed') {
    return `✅ BEKRÄFTAD — Tid: ${order.minutes} min\n` +
      `🕒 Bekräftad kl ${stockholmClock(order.confirmedAt)}` +
      (order.confirmedBy ? ` av ${order.confirmedBy}` : '');
  }
  if (order.status === 'rejected') {
    return `❌ AVVISAD` +
      (order.confirmedBy ? ` av ${order.confirmedBy}` : '') +
      ` kl ${stockholmClock(order.confirmedAt)}`;
  }
  return '⏳ VÄNTAR PÅ BEKRÄFTELSE – välj tid nedan';
}

export function formatOrderText(order) {
  const o = order.order;
  const lines = [
    'ETNA PIZZERIA — NY BESTÄLLNING'.replace(/^/, '🍕 '),
    `🆔 Order: #${order.id}`,
    statusLine(order),
    '',
    `📦 Typ: ${o.type === 'pickup' ? 'Avhämtning' : 'Utkörning'}`,
    `👤 Namn: ${o.name}`,
    `📞 Telefon: ${o.phone}`
  ];
  if (o.type === 'delivery' && o.address) lines.push(`📍 Adress: ${o.address}`);
  lines.push('', '🍽️ Varor:');
  o.items.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.qty}x ${item.name} — ${item.unitPrice * item.qty}:-`);
    if (item.details) lines.push(`   (${item.details})`);
  });
  lines.push('', `💰 Totalt: ${o.total}:-`);
  return lines.join('\n');
}

// Inline buttons. callback_data format: "t:<ORDERID>:<minutes>" or "r:<ORDERID>" (max 64 bytes)
export function buildKeyboard(order) {
  const picked = order.status === 'confirmed' ? order.minutes : null;
  const btn = (m) => ({
    text: picked === m ? `✅ ${m} min` : `${m} min`,
    callback_data: `t:${order.id}:${m}`
  });
  return {
    inline_keyboard: [
      TIMES.slice(0, 4).map(btn),
      TIMES.slice(4).map(btn),
      [{ text: order.status === 'rejected' ? '❌ Avvisad' : '❌ Avvisa beställning', callback_data: `r:${order.id}` }]
    ]
  };
}
