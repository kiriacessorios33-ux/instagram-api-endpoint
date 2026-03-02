export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const raw = (req.query.username ?? req.query.u ?? "").toString().trim();
    const username = raw.replace(/^@/, "").trim();

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

    const ACTOR_ID = "apify/instagram-profile-scraper";

    // ✅ Tentamos inputs comuns (o actor pode aceitar um deles)
    const input = {
      usernames: [username],
      username: username,
      user: username,
      profiles: [username],
    };

    // ✅ roda e já devolve os itens do dataset
    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}` +
      `/run-sync-get-dataset-items?clean=true&timeout=120&token=${encodeURIComponent(APIFY_TOKEN)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const items = await resp.json();

    if (!resp.ok) {
      return res.status(502).json({ error: "Apify error", details: items });
    }

    const first = Array.isArray(items) ? items[0] : null;
    if (!first) {
      return res.status(404).json({
        error: "Profile not found",
        hint: "Apify returned empty dataset items for this username."
      });
    }

    return res.status(200).json({
      username: first.username ?? username,
      fullName: first.fullName ?? first.full_name ?? null,
      biography: first.biography ?? first.bio ?? null,
      followersCount: first.followersCount ?? first.followers ?? null,
      followsCount: first.followsCount ?? first.following ?? null,
      postsCount: first.postsCount ?? first.posts ?? null,
      profilePicUrl: first.profilePicUrl ?? first.profile_pic_url ?? null,
      isPrivate: first.private ?? first.is_private ?? null,
      verified: first.verified ?? null,
      isBusinessAccount: first.isBusinessAccount ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}
