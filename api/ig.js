export default async function handler(req, res) {
  try {
    // aceita ?username= (principal) e ?u= (compatibilidade)
    const raw = (req.query.username ?? req.query.u ?? "").toString().trim();
    const username = raw.replace(/^@/, "").trim();

    // Instagram usernames: 1–30 chars, letras/números/._  (não pode começar/terminar com ponto e não pode ter "..")
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

    // Actor do Apify
    const ACTOR_ID = "apify/instagram-profile-scraper";

    // input mais comum: usernames como array
    const input = { usernames: [username] };

    // 1) roda o Actor e pega o runId
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?token=${encodeURIComponent(
        APIFY_TOKEN
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );

    if (!runRes.ok) {
      const txt = await runRes.text();
      return res.status(502).json({ error: "Apify run error", details: txt });
    }

    const runJson = await runRes.json();
    const runId = runJson?.data?.id;
    if (!runId) {
      return res.status(502).json({ error: "Apify runId missing" });
    }

    // 2) espera terminar
    const waitRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(
        runId
      )}/wait-for-finish?token=${encodeURIComponent(APIFY_TOKEN)}&waitSecs=60`,
      { method: "GET" }
    );

    if (!waitRes.ok) {
      const txt = await waitRes.text();
      return res.status(502).json({ error: "Apify wait error", details: txt });
    }

    const waitJson = await waitRes.json();
    const datasetId = waitJson?.data?.defaultDatasetId;
    if (!datasetId) {
      return res.status(502).json({ error: "Apify datasetId missing" });
    }

    // 3) pega itens do dataset (1 perfil)
    const dataRes = await fetch(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(
        datasetId
      )}/items?token=${encodeURIComponent(APIFY_TOKEN)}&clean=true&limit=1`,
      { method: "GET" }
    );

    if (!dataRes.ok) {
      const txt = await dataRes.text();
      return res.status(502).json({ error: "Apify dataset error", details: txt });
    }

    const items = await dataRes.json();
    const first = Array.isArray(items) ? items[0] : items;

    if (!first) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // resposta enxuta pro seu front
    return res.status(200).json({
      username: first?.username ?? username,
      fullName: first?.fullName ?? null,
      biography: first?.biography ?? null,
      followersCount: first?.followersCount ?? null,
      followsCount: first?.followsCount ?? null,
      postsCount: first?.postsCount ?? null,
      profilePicUrl: first?.profilePicUrl ?? null,
      isPrivate: first?.private ?? null,
      verified: first?.verified ?? null,
      isBusinessAccount: first?.isBusinessAccount ?? null,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
