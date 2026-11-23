// Order storage. Three backends, chosen automatically:
//  1) Netlify Blobs   (default, built into Netlify, needs no account)
//  2) Upstash Redis   (if UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set; no npm package needed)
//  3) In-memory       (ONLY for local tests: ETNA_MEMORY_STORE=1)
const memory = new Map();
const TTL_SECONDS = 60 * 60 * 24 * 3; // Upstash: keep orders 3 days

export async function getStoreApi() {
  if (process.env.ETNA_MEMORY_STORE === '1') {
    return {
      get: async (k) => (memory.has(k) ? JSON.parse(memory.get(k)) : null),
      set: async (k, v) => { memory.set(k, JSON.stringify(v)); }
    };
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const call = async (cmd) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd)
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `Upstash HTTP ${r.status}`);
      return d.result;
    };
    return {
      get: async (k) => {
        const v = await call(['GET', `etna:order:${k}`]);
        return v ? JSON.parse(v) : null;
      },
      set: async (k, v) => { await call(['SET', `etna:order:${k}`, JSON.stringify(v), 'EX', TTL_SECONDS]); }
    };
  }

  const { getStore } = await import('@netlify/blobs');
  const s = getStore({ name: 'etna-orders', consistency: 'strong' });
  return {
    get: async (k) => (await s.get(k, { type: 'json' })) ?? null,
    set: async (k, v) => { await s.setJSON(k, v); }
  };
}
