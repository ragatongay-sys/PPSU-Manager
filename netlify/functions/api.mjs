import { store } from "./lib/store.mjs";
import { createApi } from "./lib/core.mjs";
import template from "./lib/template.mjs";

const templateSnap = (/<script id="snap"[^>]*>([\s\S]*?)<\/script>/.exec(template) || [, "{}"])[1];

export default async (req) => {
  const api = createApi({ store: store(), env: process.env, templateSnap });
  return api.handle(req);
};

export const config = { path: "/api/*" };
