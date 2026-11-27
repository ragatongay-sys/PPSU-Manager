import test from "node:test";
import assert from "node:assert/strict";
import { createApi, DEFAULT_MGR_HASH } from "../netlify/functions/lib/core.mjs";
import { fakeStore } from "../testlib/fakeStore.mjs";

const mk = (env = { ADMIN_KEY: "secret" }) =>
  createApi({ store: fakeStore(), env, sleep: async () => {} });
const call = (api, method, path, body, headers = {}) =>
  api.handle(new Request("https://x.test" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));

test("auth accepts only the admin key", async () => {
  const api = mk();
  assert.equal((await call(api, "POST", "/api/auth", undefined, { "x-admin-key": "secret" })).status, 200);
  assert.equal((await call(api, "POST", "/api/auth", undefined, { "x-admin-key": "nope" })).status, 401);
  assert.equal((await call(api, "POST", "/api/auth")).status, 401);
});

test("auth is closed when ADMIN_KEY is not configured", async () => {
  const api = mk({});
  assert.equal((await call(api, "POST", "/api/auth", undefined, { "x-admin-key": "" })).status, 401);
  assert.equal((await call(api, "POST", "/api/publish", { snap: "{}" })).status, 503);
});

test("publish needs the key, validates shape, and updates version + page", async () => {
  const api = mk();
  const snap = JSON.stringify({ v: 1, ts: 99, tour: { a: 1 }, open: null });
  assert.equal((await call(api, "POST", "/api/publish", { snap })).status, 401);
  assert.equal((await call(api, "POST", "/api/publish", { snap: "not json" }, { "x-admin-key": "secret" })).status, 400);
  assert.equal((await call(api, "POST", "/api/publish", { snap: '{"x":1}' }, { "x-admin-key": "secret" })).status, 400);
  assert.equal((await call(api, "POST", "/api/publish", { snap }, { "x-admin-key": "secret" })).status, 200);
  assert.deepEqual(await (await call(api, "GET", "/api/version")).json(), { ts: 99 });
  const rec = await api.currentSnapshot();
  assert.equal(JSON.parse(rec.snap).tour.a, 1);
});

test("before any publish there is no stored snapshot (page keeps its built-in one)", async () => {
  assert.deepEqual(await (await call(mk(), "GET", "/api/version")).json(), { ts: 0 });
  assert.deepEqual(await (await call(mk(), "GET", "/api/snapshot")).json(), { none: true });
});

test("published snapshot is served to every viewer; function-style paths work too", async () => {
  const api = mk();
  const snap = JSON.stringify({ v: 1, ts: 42, tour: { n: 1 }, open: null });
  await call(api, "POST", "/api/publish", { snap }, { "x-admin-key": "secret" });
  const a = await (await call(api, "GET", "/api/snapshot")).json();
  assert.equal(JSON.parse(a.snap).tour.n, 1);
  assert.equal(a.ts, 42);
  const b = await (await call(api, "GET", "/.netlify/functions/api/snapshot")).json();
  assert.equal(b.ts, 42);
});

test("umpires score matches without any key; documents round-trip", async () => {
  const api = mk();
  assert.equal((await call(api, "PUT", "/api/db/pbmatch/g1", { data: { gid: "g1", sa: 3, sb: 2 } })).status, 200);
  assert.equal((await call(api, "PATCH", "/api/db/pbmatch/g1", { data: { sa: 4 } })).status, 200);
  const one = await (await call(api, "GET", "/api/db/pbmatch/g1")).json();
  assert.deepEqual(one, { exists: true, data: { gid: "g1", sa: 4, sb: 2 } });
  const list = await (await call(api, "GET", "/api/db/pbmatch")).json();
  assert.equal(list.docs.length, 1);
  await call(api, "DELETE", "/api/db/pbmatch/g1");
  assert.equal((await (await call(api, "GET", "/api/db/pbmatch/g1")).json()).exists, false);
});

test("ids with colons work and bad ids / collections are refused", async () => {
  const api = mk();
  assert.equal((await call(api, "PUT", "/api/db/pbmatch/q%3A12", { data: { a: 1 } })).status, 200);
  assert.equal((await call(api, "PUT", "/api/db/pbmatch/bad%20id", { data: { a: 1 } })).status, 400);
  assert.equal((await call(api, "PUT", "/api/db/secrets/x", { data: { a: 1 } })).status, 404);
  assert.equal((await call(api, "PUT", "/api/db/pbmatch/z", { data: [1] })).status, 400);
});

test("only managers may change umpire accounts; hashes never leave the server", async () => {
  const api = mk();
  const doc = { name: "Ump1", key: "ump1", h: "abc123", court: 1 };
  assert.equal((await call(api, "PUT", "/api/db/pbump/u1", { data: doc })).status, 403);
  assert.equal((await call(api, "PUT", "/api/db/pbump/u1", { data: doc }, { "x-pb-mgr": "wrong" })).status, 403);
  assert.equal((await call(api, "PUT", "/api/db/pbump/u1", { data: doc }, { "x-pb-mgr": DEFAULT_MGR_HASH })).status, 200);
  assert.equal((await call(api, "PUT", "/api/db/pbump/u2", { data: { ...doc, name: "Ump2", key: "ump2", h: "zzz" } }, { "x-admin-key": "secret" })).status, 200);
  const list = await (await call(api, "GET", "/api/db/pbump")).json();
  assert.equal(list.docs.length, 2);
  assert.ok(list.docs.every((d) => !("h" in d.data)));
  const one = await (await call(api, "GET", "/api/db/pbump/u1")).json();
  assert.ok(!("h" in one.data));
  // the stored hash still works for sign-in
  const ok = await (await call(api, "POST", "/api/ump-login", { key: "ump1", h: "abc123" })).json();
  assert.deepEqual(ok, { ok: true, user: { id: "u1", name: "Ump1", court: 1 } });
  assert.equal((await (await call(api, "POST", "/api/ump-login", { key: "ump1", h: "bad" })).json()).ok, false);
  // update keeps the hash
  await call(api, "PATCH", "/api/db/pbump/u1", { data: { court: 2 } }, { "x-admin-key": "secret" });
  assert.equal((await (await call(api, "POST", "/api/ump-login", { key: "ump1", h: "abc123" })).json()).user.court, 2);
  assert.equal((await call(api, "DELETE", "/api/db/pbump/u1")).status, 403);
  assert.equal((await call(api, "DELETE", "/api/db/pbump/u1", undefined, { "x-admin-key": "secret" })).status, 200);
});

test("match list is CDN-cacheable for a few seconds, accounts are not", async () => {
  const api = mk();
  assert.match((await call(api, "GET", "/api/db/pbmatch")).headers.get("netlify-cdn-cache-control"), /s-maxage=3/);
  assert.equal((await call(api, "GET", "/api/db/pbump")).headers.get("netlify-cdn-cache-control"), null);
});

