import { getStore } from "@netlify/blobs";
// Strong consistency so a score written by an umpire is visible to the very next read.
export const store = () => getStore({ name: "ppsu", consistency: "strong" });
