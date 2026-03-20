import { init } from "../src/content/googleScholar";

export default defineContentScript({
  matches: ["*://*.google.com/*"],
  main() {
    console.log(
      "[Scholarly][Entry] Content script loaded:",
      window.location.href,
    );
    // run domain-specific handlers
    init();
  },
});
