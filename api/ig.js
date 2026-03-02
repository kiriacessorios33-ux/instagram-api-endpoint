export default async function handler(req, res) {
  try {
    const username = (req.query.u || req.query.username || "").replace("@", "").trim();

    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }

    // Regras básicas (evita erro bobo)
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
      return res.status(400).json({ error: "Invalid username" });
    }

    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: "Missing APIFY_TOKEN env var" });
    }

    // ✅ Endpoint certo: roda o actor e já devolve os itens do dataset
    const url =
      "https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [username],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: "Apify error", details: txt });
    }

    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: "Profile not found" });
    }

    return res.status(200).json(data[0]);
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}
