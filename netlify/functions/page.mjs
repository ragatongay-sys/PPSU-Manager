import { store } from "./lib/store.mjs";
import { createApi, injectSnapshot } from "./lib/core.mjs";
import template from "./lib/template.mjs";

const templateSnap = (/<script id="snap"[^>]*>([\s\S]*?)<\/script>/.exec(template) || [, "{}"])[1];

export default async () => {
  let html = template;
  try {
    const api = createApi({ store: store(), env: process.env, templateSnap });
    const rec = await api.currentSnapshot();
    html = injectSnapshot(template, rec.snap);
  } catch (_) { /* fall back to the snapshot bundled in the template */ }
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // browsers always revalidate; the CDN may hold it for a few seconds to absorb crowds
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, s-maxage=5",
    },
  });
};

export const config = { path: ["/", "/index.html"] };
