import { scrapeOrcidProfile } from "../src/portals/orchid/scraper";
import { clearOrcidBadges } from "../src/portals/orchid/profileInjector";
import { getGoogleScholarEnabled } from "../src/utils/storage";
import { extractOrcidId } from "../src/portals/orchid/orcidApiClient";

export default defineContentScript({
  matches: ["https://orcid.org/*"],
  runAt: "document_idle",

  async main() {
    console.log("[Scholarly][ORCID] Content script initialized");
    console.log("[Scholarly][ORCID] URL:", window.location.href);

    // Only run on actual ORCID profile pages (not home/search pages)
    const orcidId = extractOrcidId(window.location.href);
    if (!orcidId) {
      console.log("[Scholarly][ORCID] Not a profile page, exiting");
      return;
    }

    let runGeneration = 0;
    const nextGeneration = () => { runGeneration += 1; return runGeneration; };

    const maybeScrape = async (enabled: boolean) => {
      if (enabled) {
        const gen = nextGeneration();
        await scrapeOrcidProfile({ shouldContinue: () => gen === runGeneration });
      } else {
        nextGeneration();
        clearOrcidBadges();
      }
    };

    // Read initial enabled state
    getGoogleScholarEnabled()
      .then((enabled: boolean) => maybeScrape(enabled))
      .catch(() => maybeScrape(true)); // fail-safe: run anyway

    // Listen for popup toggle messages
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "TOGGLE_CHANGED") {
        maybeScrape(Boolean(message.enabled))
          .then(() => sendResponse({ received: true, success: true }))
          .catch((err) => sendResponse({ received: true, success: false, error: err }));
        return true;
      }
      sendResponse({ received: true });
    });
  },
});
