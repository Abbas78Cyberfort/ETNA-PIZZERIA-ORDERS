// Online orders are accepted 11:00–20:45 (Europe/Stockholm), even though the shop shows 11:00–21:00.
export const ORDER_OPEN_MIN = 11 * 60;
export const ORDER_LAST_MIN = 20 * 60 + 45;

export function stockholmMinutes(now = new Date()) {
  let h = 0, m = 0;
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(now).forEach((p) => {
      if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') m = parseInt(p.value, 10);
    });
  return h * 60 + m;
}

export function orderingOpen(now = new Date()) {
  if (process.env.ETNA_FORCE_OPEN === '1') return true; // tests only
  const t = stockholmMinutes(now);
  return t >= ORDER_OPEN_MIN && t <= ORDER_LAST_MIN;
}

export function closedMessage(now = new Date()) {
  return stockholmMinutes(now) < ORDER_OPEN_MIN
    ? 'Onlinebeställning öppnar kl 11:00. Du kan ringa oss på 018-20 35 60.'
    : 'Onlinebeställning är stängd (sista beställning kl 20:45). Ring oss på 018-20 35 60.';
}
