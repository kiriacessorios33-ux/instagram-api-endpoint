export default async function handler(req, res) {
  // ===== CORS (para seu site chamar a API) =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  // ===== Cache na Vercel (CDN) =====
  // 5 min cache + revalida em background
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // aceita ?username= (principal) ou ?u= (compatibilidade)
    const raw = (req.query.username ?? req.query.u ?? "").toString().trim();
    const username = raw.replace(/^@/, "").trim();

    // validação IG: 1–30, letras/números/._ ; não começa/termina com ponto; sem ".."
    const basic = /^[A-Za-z0-9._]{1,30}$/.test(username);
    const noEdgeDots = username && !username.startsWith(".") && !username.endsWith(".");
    const noDoubleDots = !username.includes("..");
    if (!basic || !noEdgeDots || !noDoubleDots) {
      return res.status(400).json({ error: "Invalid username" });
    }

    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: "Missing APIFY_TOKEN env var" });
    }

    // ===== Cache em memória (acelera MUITO se repetir o mesmo user) =====
    // (Vercel pode “resetar” às vezes, mas quando mantém quente fica instantâneo)
    globalThis.__IG_CACHE__ = globalThis.__IG_CACHE__ || new Map();
    const memKey = username.toLowerCase();
    const now = Date.now();
    const mem = globalThis.__IG_CACHE__.get(memKey);
    if (mem && now - mem.ts < 5 * 60 * 1000) {
      return res.status(200).json(mem.data);
    }

    // ===== Apify Turbo endpoint: roda e já devolve dataset =====
    const ACTOR_ID = "apify/instagram-profile-scraper";
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
      ACTOR_ID
    )}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}&format=json&clean=1`;

    // input do actor (mantenha simples pra ficar rápido)
    const input = {
      usernames: [username],
      resultsType: "details",
      resultsLimit: 1,
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(502).json({
        error: "Apify error",
        status: r.status,
        details: txt?.slice(0, 800) || "No details",
      });
    }

    const items = await r.json();
    const first = Array.isArray(items) ? items[0] : null;

    if (!first) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // resposta enxuta e estável pro seu front
    const data = {
      username: first.username ?? username,
      fullName: first.fullName ?? null,
      biography: first.biography ?? null,
      followersCount: first.followersCount ?? null,
      followsCount: first.followsCount ?? null,
      postsCount: first.postsCount ?? null,
      profilePicUrl: first.profilePicUrl ?? null,
      isPrivate: first.private ?? first.isPrivate ?? null,
      verified: first.verified ?? null,
      isBusinessAccount: first.isBusinessAccount ?? null,
      // opcional: link direto
      instagramUrl: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    };

    globalThis.__IG_CACHE__.set(memKey, { ts: now, data });

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
