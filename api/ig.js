export default async function handler(req, res) {
  try {
    const uRaw = (req.query.u || "").toString().trim();
    const username = uRaw.replace(/^@/, "");

    if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
      return res.status(400).json({ error: "Invalid username" });
    }

    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: "Missing APIFY_TOKEN env var" });
    }

    const ACTOR_ID = "apify/instagram-profile-scraper";

    const input = {
      usernames: [username],
    };

    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: "Apify error", details: txt });
    }

    const data = await r.json();
    const first = Array.isArray(data) ? data[0] : data;

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
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}
