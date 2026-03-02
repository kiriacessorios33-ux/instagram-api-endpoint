export default async function handler(req, res) {
  // ✅ CORS (permite seu site chamar a API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight (quando o browser checa permissões)
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // aceita ?username= (principal) e ?u= (compatibilidade)
    const raw = (req.query.username ?? req.query.u ?? "").toString().trim();
    const username = raw.replace(/^@/, "").trim();

    // validação de username do Instagram
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

    // input do actor (bem simples)
    const input = {
      usernames: [username],
    };

    // 1) dispara o run (wait até terminar)
    const runUrl =
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/runs?wait=120&token=${encodeURIComponent(APIFY_TOKEN)}`;

    const runResp = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const runData = await runResp.json();

    if (!runResp.ok) {
      return res.status(500).json({
        error: "Apify run error",
        details: runData,
      });
    }

    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      return res.status(500).json({ error: "Missing dataset id from Apify" });
    }

    // 2) busca o dataset (resultado)
    const itemsUrl =
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&token=${encodeURIComponent(APIFY_TOKEN)}`;

    const itemsResp = await fetch(itemsUrl);
    const items = await itemsResp.json();

    if (!itemsResp.ok) {
      return res.status(500).json({ error: "Apify dataset error", details: items });
    }

    const first = Array.isArray(items) ? items[0] : null;
    if (!first) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // resposta enxuta pro seu front
    return res.status(200).json({
      username: first.username ?? username,
      fullName: first.fullName ?? null,
      biography: first.biography ?? null,
      followersCount: first.followersCount ?? null,
      followsCount: first.followsCount ?? null,
      postsCount: first.postsCount ?? null,
      profilePicUrl: first.profilePicUrl ?? null,
      isPrivate: first.private ?? null,
      verified: first.verified ?? null,
      isBusinessAccount: first.isBusinessAccount ?? null,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      details: String(e?.message || e),
    });
  }
}
