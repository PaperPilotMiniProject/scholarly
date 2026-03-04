import { init } from "../src/content/googleScholar";

export default defineContentScript({
  matches: ["*://*.google.com/*"],
  main() {
    // run domain-specific handlers
    init();
  },
});
