import { store } from "./lib/store.mjs";
import { createApi } from "./lib/core.mjs";

export default async (req) => {
  const api = createApi({ store: store(), env: process.env });
  return api.handle(req);
};

export const config = { path: "/api/*" };
