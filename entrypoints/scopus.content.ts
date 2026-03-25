// Explicit relative import with extension to satisfy Vite/WXT resolver
import { init } from "../src/content/scopus.js";

export default defineContentScript({
  matches: ["*://*.scopus.com/*"],
  runAt: "document_idle",
  main() {
    console.log("[Scholarly] Loaded");
    init();
  },
});

