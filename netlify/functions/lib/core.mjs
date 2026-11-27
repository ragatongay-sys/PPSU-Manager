// Pure request logic. The Netlify wrappers inject a Blobs store; tests inject a fake one.
import { createHash, timingSafeEqual } from "node:crypto";

export const COLLECTIONS = new Set(["pbmatch", "pbump"]);
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_DOC = 30 * 1024;
const MAX_SNAP = 4 * 1024 * 1024;
// Same value the app has always used for the default "PPSU" umpire manager.
export const DEFAULT_MGR_HASH = "c95b691ed7ecb9c3362c4f441cc9374c181d347e6750a9daf8a3cc5ba1e33863";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const digest = (s) => createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => timingSafeEqual(digest(a), digest(b));

export function createApi({ store, env = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const adminKey = env.ADMIN_KEY || "";
  const mgrHash = env.UMP_MGR_HASH || DEFAULT_MGR_HASH;

  const isAdmin = (req) => !!adminKey && safeEq(req.headers.get("x-admin-key") || "", adminKey);
  const isMgr = (req) => isAdmin(req) || safeEq(req.headers.get("x-pb-mgr") || "", mgrHash);

  const docKey = (col, id) => `db/${col}/${encodeURIComponent(id)}`;

  async function readDoc(col, id) {
    return store.get(docKey(col, id), { type: "json" });
  }
  async function listDocs(col) {
    const { blobs } = await store.list({ prefix: `db/${col}/` });
    const docs = await Promise.all(
      blobs.map(async (b) => {
        const data = await store.get(b.key, { type: "json" });
        const id = decodeURIComponent(b.key.slice(`db/${col}/`.length));
        return data ? { id, data } : null;
      })
    );
    return docs.filter(Boolean);
  }
  const publicDoc = (col, data) => {
    if (col !== "pbump" || !data) return data;
    const { h, ...rest } = data; // never send umpire password hashes to browsers
    return rest;
  };

  async function currentSnapshot() {
    try {
      const rec = await store.get("snapshot", { type: "json" });
      if (rec && rec.snap) return rec;
    } catch (_) {}
    return null;
  }

  async function handle(req) {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const [route, col, id] = parts;
    const method = req.method.toUpperCase();

    try {
      if (route === "version" && method === "GET") {
        const rec = await currentSnapshot();
        return json({ ts: rec ? rec.ts : 0 }, 200, { "netlify-cdn-cache-control": "public, s-maxage=5" });
      }

      if (route === "snapshot" && method === "GET") {
        const rec = await currentSnapshot();
        return json(rec ? { snap: rec.snap, ts: rec.ts } : { none: true }, 200, { "netlify-cdn-cache-control": "public, s-maxage=5" });
      }

      if (route === "auth" && method === "POST") {
        if (isAdmin(req)) return json({ ok: true });
        await sleep(600); // slow down guessing
        return json({ ok: false }, 401);
      }

      if (route === "publish" && method === "POST") {
        if (!adminKey) return json({ error: "Server is missing the ADMIN_KEY setting." }, 503);
        if (!isAdmin(req)) { await sleep(600); return json({ error: "Wrong admin key." }, 401); }
        const body = await req.json().catch(() => null);
        const raw = body && typeof body.snap === "string" ? body.snap : null;
        if (!raw || raw.length > MAX_SNAP) return json({ error: "Invalid snapshot." }, 400);
        let obj;
        try { obj = JSON.parse(raw); } catch (_) { return json({ error: "Snapshot is not valid JSON." }, 400); }
        if (!obj || typeof obj !== "object" || !("tour" in obj) || !("open" in obj)) return json({ error: "Snapshot has the wrong shape." }, 400);
        const ts = Number(obj.ts) || Date.now();
        await store.setJSON("snapshot", { snap: JSON.stringify(obj), ts, at: Date.now() });
        return json({ ok: true, ts });
      }

      if (route === "ump-login" && method === "POST") {
        const b = await req.json().catch(() => null);
        if (!b || typeof b.key !== "string" || typeof b.h !== "string") return json({ ok: false }, 400);
        const docs = await listDocs("pbump");
        const hit = docs.find((d) => d.data && d.data.key === b.key && d.data.h === b.h);
        if (!hit) { await sleep(400); return json({ ok: false }); }
        return json({ ok: true, user: { id: hit.id, name: hit.data.name, court: hit.data.court || 0 } });
      }

      if (route === "db" && COLLECTIONS.has(col)) {
        if (!id && method === "GET") {
          const docs = (await listDocs(col)).map((d) => ({ id: d.id, data: publicDoc(col, d.data) }));
          const headers = col === "pbmatch" ? { "netlify-cdn-cache-control": "public, s-maxage=3" } : {};
          return json({ docs }, 200, headers);
        }
        if (id) {
          if (!ID_RE.test(id)) return json({ error: "Bad document id." }, 400);
          if (method === "GET") {
            const d = await readDoc(col, id);
            return json({ exists: !!d, data: publicDoc(col, d) || null });
          }
          if (["PUT", "PATCH", "DELETE"].includes(method)) {
            if (col === "pbump" && !isMgr(req)) return json({ error: "Not allowed to manage umpires." }, 403);
            if (method === "DELETE") {
              await store.delete(docKey(col, id));
              return json({ ok: true });
            }
            const b = await req.json().catch(() => null);
            const data = b && b.data;
            if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Body must be {data:{...}}." }, 400);
            if (JSON.stringify(data).length > MAX_DOC) return json({ error: "Document too large." }, 413);
            if (method === "PUT") {
              await store.setJSON(docKey(col, id), data);
            } else {
              const cur = await readDoc(col, id);
              if (!cur) return json({ error: "Document not found." }, 404);
              await store.setJSON(docKey(col, id), { ...cur, ...data });
            }
            return json({ ok: true });
          }
        }
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      return json({ error: "Server error." }, 500);
    }
  }
  return { handle, currentSnapshot };
}
