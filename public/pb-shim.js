/*
 * PPSU Game Management - hosting shim
 * Gives the app the shared database, publishing and "who is the admin" features it
 * needs, backed by Netlify Functions (see netlify/functions). Loaded before the app.
 */
(function () {
  "use strict";
  var API = "/api";
  var KEY_STORE = "pb_admin_key";
  // Value the app has always used for the default "PPSU" umpire manager login.
  var DEFH = "c95b691ed7ecb9c3362c4f441cc9374c181d347e6750a9daf8a3cc5ba1e33863";
  var POLL_MS = 4000;
  var VERSION_MS = 15000;

  function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
  function setKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (e) {} }

  function headers(keyOverride) {
    var h = { "content-type": "application/json" };
    var k = keyOverride !== undefined ? keyOverride : getKey();
    if (k) h["x-admin-key"] = k;
    try {
      var u = JSON.parse(sessionStorage.getItem("pbump") || "null");
      if (u && u.def) h["x-pb-mgr"] = DEFH;
    } catch (e) {}
    return h;
  }

  function request(method, path, body, keyOverride) {
    return fetch(API + path, {
      method: method,
      headers: headers(keyOverride),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var e = new Error((j && j.error) || "HTTP " + r.status);
          e.status = r.status;
          e.code = r.status === 401 || r.status === 403 ? "permission_denied"
                 : r.status === 429 ? "resource_exhausted"
                 : r.status === 503 ? "not_configured" : "unavailable";
          throw e;
        }
        return j;
      });
    });
  }

  /* ---------------- shared database ---------------- */
  function mkSnap(docs, changes) {
    var list = docs.map(function (d) { return { id: d.id, data: function () { return d.data; } }; });
    return {
      docs: list,
      size: list.length,
      empty: list.length === 0,
      docChanges: function () {
        return (changes || []).map(function (c) {
          return { type: c.type, doc: { id: c.id, data: function () { return c.data; } } };
        });
      },
      forEach: function (fn) { list.forEach(fn); }
    };
  }

  function docRef(path) {
    var i = path.indexOf("/");
    var col = path.slice(0, i), id = path.slice(i + 1);
    var url = "/db/" + encodeURIComponent(col) + "/" + encodeURIComponent(id);
    return {
      id: id,
      get: function () {
        return request("GET", url).then(function (j) {
          return { id: id, exists: !!(j && j.exists), data: function () { return j ? j.data : null; } };
        });
      },
      set: function (d) { return request("PUT", url, { data: d }); },
      update: function (d) { return request("PATCH", url, { data: d }); },
      "delete": function () { return request("DELETE", url); }
    };
  }

  function collectionRef(col) {
    var url = "/db/" + encodeURIComponent(col);
    return {
      doc: function (id) { return docRef(col + "/" + id); },
      get: function () {
        return request("GET", url).then(function (j) { return mkSnap((j && j.docs) || [], []); });
      },
      onSnapshot: function (cb, onErr) {
        var prev = null, stopped = false, timer = null;
        function tick() {
          if (stopped) return;
          if (document.hidden && prev) { timer = setTimeout(tick, POLL_MS); return; }
          request("GET", url).then(function (j) {
            if (stopped) return;
            var docs = (j && j.docs) || [], cur = {}, changes = [];
            docs.forEach(function (d) {
              var s = JSON.stringify(d.data);
              cur[d.id] = { s: s, data: d.data };
              if (!prev || !prev[d.id]) changes.push({ type: "added", id: d.id, data: d.data });
              else if (prev[d.id].s !== s) changes.push({ type: "modified", id: d.id, data: d.data });
            });
            if (prev) Object.keys(prev).forEach(function (id) {
              if (!cur[id]) changes.push({ type: "removed", id: id, data: prev[id].data });
            });
            var first = prev === null;
            prev = cur;
            if (first || changes.length) {
              try { cb(mkSnap(docs, changes)); } catch (e) { if (window.console) console.error(e); }
            }
          }).catch(function (e) {
            if (onErr) { try { onErr(e); } catch (x) {} }
          }).then(function () {
            if (!stopped) timer = setTimeout(tick, POLL_MS + Math.floor(Math.random() * 600));
          });
        }
        tick();
        return function () { stopped = true; if (timer) clearTimeout(timer); };
      }
    };
  }

  var db = { doc: docRef, collection: collectionRef };

  /* ---------------- who is the administrator ---------------- */
  // A key the server has already accepted is remembered on this device, so choosing
  // "Administrator" opens instantly instead of waiting for a server round trip every time.
  // It is still re-checked quietly in the background, and publishing is always checked
  // by the server, so a remembered key never grants anything the server would refuse.
  var OK_STORE = "pb_admin_ok";
  function fp(k) { var h = 5381; for (var i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0; return "v1:" + h.toString(36); }
  function isRemembered(k) { try { return !!k && localStorage.getItem(OK_STORE) === fp(k); } catch (e) { return false; } }
  function remember(k) { try { if (k) localStorage.setItem(OK_STORE, fp(k)); else localStorage.removeItem(OK_STORE); } catch (e) {} }

  var pending = null, pendingKey = "", rechecked = false;
  // Asks the server once per key per page; parallel callers share the same request.
  // Resolves "ok", "bad" (key rejected) or "net" (server unreachable).
  function check(k) {
    if (pending && pendingKey === k) return pending;
    pendingKey = k;
    pending = fetch(API + "/auth", { method: "POST", headers: headers(k), cache: "no-store" })
      .then(function (r) {
        if (r.ok) { remember(k); return "ok"; }
        if (r.status === 401 || r.status === 403) {
          if (getKey() === k) { setKey(""); remember(""); }
          return "bad";
        }
        return "net";
      })
      .catch(function () { return "net"; });
    var mine = pending;
    mine.then(function (v) { if (v !== "ok" && pending === mine) pending = null; });
    return mine;
  }

  function verifyStored() {
    var k = getKey();
    if (!k) return Promise.resolve(false);
    if (isRemembered(k)) {
      if (!rechecked) { rechecked = true; check(k); } // background re-check, not awaited
      return Promise.resolve(true);
    }
    return check(k).then(function (v) { return v === "ok"; });
  }
  // Start checking a saved key right away so the answer is ready by the time it's needed.
  if (getKey() && !isRemembered(getKey())) check(getKey());

  var user = {
    canEdit: verifyStored,
    isOwner: verifyStored,
    can: function () { return Promise.resolve(null); }
  };

  function askKey() {
    return new Promise(function (resolve) {
      var wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
      wrap.innerHTML =
        '<form style="background:#fff;color:#111;border-radius:16px;padding:20px;max-width:360px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)">' +
        '<h3 style="margin:0 0 6px;font-size:18px">Administrator key</h3>' +
        '<p style="margin:0 0 12px;font-size:14px;color:#555">Enter the admin key set for this site. It is remembered on this device only.</p>' +
        '<input type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:2px solid #ccc;border-radius:10px" aria-label="Administrator key">' +
        '<div id="pbkerr" style="color:#c0301f;font-size:13px;min-height:18px;margin-top:6px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" data-c style="flex:1;padding:12px;border-radius:10px;border:2px solid #ccc;background:#fff;font-size:15px">Cancel</button>' +
        '<button type="submit" style="flex:1;padding:12px;border-radius:10px;border:0;background:#1f7a3d;color:#fff;font-weight:700;font-size:15px">Continue</button></div></form>';
      document.body.appendChild(wrap);
      var form = wrap.querySelector("form"), inp = wrap.querySelector("input"), err = wrap.querySelector("#pbkerr");
      inp.focus();
      function close(v) { wrap.remove(); resolve(v); }
      wrap.querySelector("[data-c]").onclick = function () { close(""); };
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var k = inp.value.trim();
        if (!k) return;
        err.textContent = "Checking\u2026";
        check(k).then(function (v) {
          if (v === "ok") { setKey(k); remember(k); close(k); }
          else if (v === "bad") { err.textContent = "That key is not correct."; inp.select(); }
          else err.textContent = "Could not reach the server. Check your connection.";
        });
      };
    });
  }

  // The app calls this when someone chooses "Administrator".
  window.__pbAuth = function () {
    return verifyStored().then(function (ok) {
      if (ok) return true;
      return askKey().then(function (k) { return !!k; });
    });
  };
  window.__pbForgetAdminKey = function () { setKey(""); remember(""); };

  // Umpire sign-in is checked on the server so password hashes never reach browsers.
  window.__pbUmpLogin = function (key, h) {
    return request("POST", "/ump-login", { key: key, h: h }).then(function (j) { return j && j.ok ? j.user : null; });
  };

  /* ---------------- publishing ---------------- */
  var artifact = {
    publish: function (html) {
      var m = /<script id="snap"[^>]*>([\s\S]*?)<\/script>/.exec(html);
      if (!m) { var e = new Error("No snapshot found"); e.code = "invalid"; return Promise.reject(e); }
      return request("POST", "/publish", { snap: m[1] }).then(function (res) {
        // Reload with a unique query so the CDN can't hand back the previous page.
        setTimeout(function () { location.replace(location.pathname + "?_=" + Date.now()); }, 700);
        return res;
      }, function (e) {
        // The server no longer accepts this key (e.g. ADMIN_KEY was changed): forget it.
        if (e && e.status === 401) { setKey(""); remember(""); }
        throw e;
      });
    }
  };

  window.claude = {
    use: function (name) {
      if (name === "db") return Promise.resolve(db);
      if (name === "user") return Promise.resolve(user);
      if (name === "artifact" || name === "self") return Promise.resolve(artifact);
      return Promise.resolve(null);
    }
  };

  /* ---------------- viewers pick up new publishes automatically ---------------- */
  function pageTs() {
    try { return JSON.parse(document.getElementById("snap").textContent).ts || 0; } catch (e) { return 0; }
  }
  function startAutoRefresh() {
    var mine = pageTs();
    setInterval(function () {
      if (document.hidden) return;
      var role = ""; try { role = sessionStorage.getItem("pbrole") || ""; } catch (e) {}
      if (role === "admin" || role === "umpire") return; // never interrupt someone who is working
      fetch(API + "/version", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ts && mine && j.ts !== mine) location.replace(location.pathname + "?_=" + Date.now());
        })
        .catch(function () {});
    }, VERSION_MS);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startAutoRefresh);
  else startAutoRefresh();
})();
