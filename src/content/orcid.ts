import { scrapeOrcidProfile } from "@/portals/orchid/scraper";
import { clearOrcidBadges } from "@/portals/orchid/profileInjector";
import { getOrcidEnabled } from "@/utils/storage";
import { extractOrcidId } from "@/portals/orchid/orcidApiClient";

export default defineContentScript({
  matches: ["https://orcid.org/*"],
  runAt: "document_idle",

  async main() {
    console.log("[Scholarly][ORCID] Content script initialized");
    console.log("[Scholarly][ORCID] URL:", window.location.href);

    // Wait for ORCID's Angular app to bootstrap and settle
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("[Scholarly][ORCID] Initial delay complete, proceeding...");

    const handleUrlChange = async () => {
      const url = window.location.href;
      const orcidId = extractOrcidId(url);

      if (!orcidId) {
        console.log("[Scholarly][ORCID] Not a profile page");
        clearOrcidBadges();
        return;
      }

      console.log("[Scholarly][ORCID] Profile detected:", orcidId);

      getOrcidEnabled()
        .then((enabled) => maybeScrape(enabled))
        .catch(() => maybeScrape(true));
    };

    await handleUrlChange();

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

    let lastUrl = window.location.href;

    setInterval(() => {
      const currentUrl = window.location.href;

      if (currentUrl !== lastUrl) {
        console.log("[Scholarly][ORCID] URL changed:", currentUrl);
        lastUrl = currentUrl;

        // cancel previous run
        nextGeneration();

        const orcidId = extractOrcidId(currentUrl);
        if (!orcidId) {
          clearOrcidBadges();
          return;
        }

        getOrcidEnabled()
          .then((enabled) => maybeScrape(enabled))
          .catch(() => maybeScrape(true));
      }
    }, 1000);

    // Read initial enabled state
    getOrcidEnabled()
      .then((enabled: boolean) => maybeScrape(enabled))
      .catch(() => maybeScrape(true)); // fail-safe: run anyway

    // Listen for popup toggle messages
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "TOGGLE_ORCID_CHANGED") {
        maybeScrape(Boolean(message.enabled))
          .then(() => sendResponse({ received: true, success: true }))
          .catch((err) => sendResponse({ received: true, success: false, error: err }));
        return true;
      }
      sendResponse({ received: true });
    });
  },
});

