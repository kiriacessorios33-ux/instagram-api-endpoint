export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = (req.query.url || "").toString();
    if (!url) return res.status(400).send("Missing url");

    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (!host.includes("fbcdn.net") && !host.includes("cdninstagram.com")) {
      return res.status(403).send("Host not allowed");
    }

    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.instagram.com/"
      }
    });

    if (!r.ok) return res.status(502).send("Failed to fetch image");

    const contentType = r.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("Proxy error");
  }
}
