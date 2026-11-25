import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

export const config = { path: "/api/live" };

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!pw || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  const store = getStore("ppsu");

  // Anyone can read the published snapshot
  if (req.method === "GET") {
    const data = await store.get("live", { type: "json" });
    return new Response(JSON.stringify(data || {}), { headers: H });
  }

  // POST = password check only (used by the Administrator login)
  if (req.method === "POST") {
    return authorized(req)
      ? new Response('{"ok":true}', { headers: H })
      : new Response('{"error":"unauthorized"}', { status: 401, headers: H });
  }

  // Only the administrator can publish
  if (req.method === "PUT") {
    if (!authorized(req))
      return new Response('{"error":"unauthorized"}', { status: 401, headers: H });
    let body;
    try { body = await req.json(); }
    catch { return new Response('{"error":"bad json"}', { status: 400, headers: H }); }
    if (!body || typeof body !== "object")
      return new Response('{"error":"bad body"}', { status: 400, headers: H });
    await store.setJSON("live", body);
    return new Response('{"ok":true}', { headers: H });
  }

  return new Response("Method not allowed", { status: 405 });
};
