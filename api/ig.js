export default async function handler(req, res) {
  // ===== CORS =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  // CDN cache (leve). O cache real é o KV.
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  // ====== Helpers KV (Upstash via Vercel Integration) ======
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN =
    process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

  async function kvGet(key) {
    if (!KV_URL || !KV_TOKEN) return null;
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    }).catch(() => null);
    if (!r || !r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.result ?? null;
  }

  async function kvSetEx(key, value, ttlSeconds) {
    if (!KV_URL || !process.env.KV_REST_API_TOKEN) return false; // precisa token de escrita
    const token = process.env.KV_REST_API_TOKEN;

    // SET key value
    const r1 = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    }).catch(() => null);

    if (!r1 || !r1.ok) return false;

    // EXPIRE key ttl
    await fetch(
      `${KV_URL}/expire/${encodeURIComponent(key)}/${encodeURIComponent(
        String(ttlSeconds)
      )}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ).catch(() => null);

    return true;
  }

  // ====== Helper fetch timeout ======
  async function fetchWithTimeout(url, options = {}, ms = 12000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      return r;
    } finally {
      clearTimeout(id);
    }
  }

  try {
    // =========================================================
    // MODO IMAGEM (proxy): /api/ig?img=1&src=https://...
    // Isso resolve foto quebrando por CORS/403 no front
    // =========================================================
    const imgMode = (req.query.img ?? "").toString() === "1";
    if (imgMode) {
      const src = (req.query.src ?? "").toString();
      if (!src || !/^https?:\/\//i.test(src)) {
        return res.status(400).send("Missing/invalid src");
      }

      const r = await fetchWithTimeout(
        src,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "image/*,*/*;q=0.8",
          },
        },
        8000
      ).catch(() => null);

      if (!r || !r.ok) return res.status(502).send("Failed to fetch image");

      const contentType = r.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await r.arrayBuffer());

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, s-maxage=3600, max-age=3600");
      return res.status(200).send(buf);
    }

    // =========================================================
    // MODO PERFIL: /api/ig?username=xxx  (ou ?u=xxx)
    // =========================================================

    const raw = (req.query.username ?? req.query.u ?? "").toString().trim();
    const username = raw.replace(/^@/, "").trim();

    const basic = /^[A-Za-z0-9._]{1,30}$/.test(username);
    const noEdgeDots =
      username && !username.startsWith(".") && !username.endsWith(".");
    const noDoubleDots = !username.includes("..");
    if (!basic || !noEdgeDots || !noDoubleDots) {
      return res.status(400).json({ error: "Invalid username" });
    }

    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: "Missing APIFY_TOKEN env var" });
    }

    const key = `ig:${username.toLowerCase()}`;

    // 1) KV cache (escala de verdade)
    const cached = await kvGet(key);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json(cached);
    }

    // 2) Cache em memória (opcional, ajuda quando instância fica quente)
    globalThis.__IG_CACHE__ = globalThis.__IG_CACHE__ || new Map();
    const memKey = username.toLowerCase();
    const now = Date.now();
    const mem = globalThis.__IG_CACHE__.get(memKey);
    if (mem && now - mem.ts < 5 * 60 * 1000) {
      res.setHeader("X-Cache", "MEM");
      return res.status(200).json(mem.data);
    }

    // 3) Apify (fonte)
    const ACTOR_ID = "apify/instagram-profile-scraper";
    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(
        APIFY_TOKEN
      )}&format=json&clean=1`;

    const input = {
      usernames: [username],
      resultsType: "details",
      resultsLimit: 1,
    };

    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      12000
    ).catch(() => null);

    if (!r || !r.ok) {
      const details = r ? await r.text().catch(() => "") : "No response";
      return res.status(502).json({
        error: "Apify error",
        status: r?.status ?? 0,
        details: (details || "").slice(0, 800),
      });
    }

    const items = await r.json();
    const first = Array.isArray(items) ? items[0] : null;

    if (!first) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Base URL do seu domínio (para montar o proxy da imagem)
    const base = `${req.headers["x-forwarded-proto"] || "https"}://${
      req.headers.host
    }`;

    const profilePicUrl = first.profilePicUrl ?? null;

    const data = {
      username: first.username ?? username,
      fullName: first.fullName ?? null,
      biography: first.biography ?? null,
      followersCount: first.followersCount ?? null,
      followsCount: first.followsCount ?? null,
      postsCount: first.postsCount ?? null,
      profilePicUrl,
      // ✅ use este no front (não quebra):
      profilePicProxyUrl: profilePicUrl
        ? `${base}/api/ig?img=1&src=${encodeURIComponent(profilePicUrl)}`
        : null,
      isPrivate: first.private ?? first.isPrivate ?? null,
      verified: first.verified ?? null,
      isBusinessAccount: first.isBusinessAccount ?? null,
      instagramUrl: `https://www.instagram.com/${encodeURIComponent(
        username
      )}/`,
    };

    // guarda em memória (rápido)
    globalThis.__IG_CACHE__.set(memKey, { ts: now, data });

    // guarda no KV por 1 hora (escala real)
    await kvSetEx(key, data, 60 * 60);

    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
