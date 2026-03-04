/// <reference types="chrome" />

import { getGoogleScholarEnabled } from "../../src/utils/storage";
import {
  loadSJRData,
  findRanking,
  JournalRanking,
} from "../../src/utils/csvParser";

interface Article {
  title: string;
  link: string;
  journal?: string;
  year?: string;
  citations?: number;
  ranking?: JournalRanking;
  // allow multiple data sources to be augmented later
  extra?: Record<string, unknown>;
}

/**
 * Collects all visible article results from a Google Scholar search page with journal rankings.
 */
async function scrapeArticles(): Promise<void> {
  console.log("[Scholarly] Starting Google Scholar scrape...");

  try {
    // Load SJR rankings data
    console.log("[Scholarly] About to load SJR rankings...");
    const rankings = await loadSJRData();
    console.log(
      `[Scholarly] Finished loading. Total rankings loaded: ${rankings.length}`,
    );
    if (rankings.length === 0) {
      console.warn(
        "[Scholarly] No rankings data loaded - CSV may not be accessible",
      );
    } else {
      console.log(
        "[Scholarly] Sample rankings:",
        rankings.slice(0, 3).map((r) => `${r.rank}. ${r.title}`),
      );
    }

    const collected: Article[] = [];

    // Google Scholar uses .gs_r for result rows and .gs_rt for the title/link container
    const results = document.querySelectorAll(".gs_r");
    console.log(`[Scholarly] Found ${results.length} result containers`);

    results.forEach((row, index) => {
      try {
        const titleEl = row.querySelector(".gs_rt") as HTMLElement | null;
        if (!titleEl) {
          console.log(`[Scholarly] Result ${index}: No title element found`);
          return;
        }

        const title = titleEl.innerText.trim();
        const linkEl = titleEl.querySelector("a") as HTMLAnchorElement | null;
        const link = linkEl ? linkEl.href : "";

        // Extract journal, year and citation count from source info
        let journal = "";
        let year = "";
        let citations = 0;
        const sourceEl = row.querySelector(".gs_a") as HTMLElement | null;
        if (sourceEl) {
          const sourceText = sourceEl.innerText;
          console.log(
            `[Scholarly] Raw source text for result ${index}: "${sourceText}"`,
          );

          // citation link in .gs_fl
          const fl = row.querySelectorAll(".gs_fl a");
          fl.forEach((a) => {
            const t = a.textContent || "";
            if (t.startsWith("Cited by")) {
              const num = parseInt(t.replace(/[^0-9]/g, ""), 10);
              if (!isNaN(num)) citations = num;
            }
          });

          // Try to extract journal from the source text
          // Format can be: "Authors - Journal - Year" or "Authors - [Journal abbreviation]"
          // or sometimes just: "Authors, Journal, Year"
          let parts = sourceText.split(" - ");

          if (parts.length >= 2) {
            // ...same as before
            let potentialJournal = parts[1].trim();
            potentialJournal = potentialJournal
              .replace(/,?\s*\d{4}\s*$/, "")
              .trim();
            potentialJournal = potentialJournal.replace(/,+$/, "").trim();
            journal = potentialJournal;
            const yearMatch = sourceText.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              year = yearMatch[0];
            }
          } else {
            parts = sourceText.split(",");
            if (parts.length >= 2) {
              journal = parts[1].trim();
              journal = journal.replace(/,?\s*\d{4}\s*$/, "").trim();
            }
          }

          console.log(
            `[Scholarly] Extracted journal: "${journal}", year: "${year}", citations: ${citations}`,
          );
        }

        if (title) {
          const article: Article = {
            title,
            link,
            journal,
            year,
            citations,
            extra: {},
          };

          // Find ranking for this journal
          if (journal && rankings.length > 0) {
            console.log(
              `[Scholarly] Searching for ranking: journal="${journal}", rankings available=${rankings.length}`,
            );
            const ranking = findRanking(journal, rankings);
            if (ranking) {
              article.ranking = ranking;
              console.log(
                `[Scholarly] ✓ Article ${collected.length + 1}: "${title.substring(0, 50)}..." | Journal: ${journal} | Rank: ${ranking.rank} (SJR: ${ranking.sjr}, Q${ranking.quartile})`,
              );
              // inject DOM badge for ranking and citations
              const badge = document.createElement("span");
              badge.style.cssText =
                "margin-left:8px;padding:2px 4px;background:#ffeb3b;color:#000;font-size:10px;border-radius:3px;";
              badge.textContent = `SJR ${ranking.sjr} (Q${ranking.quartile})`;
              titleEl.appendChild(badge);
              if (citations) {
                const citeBadge = document.createElement("span");
                citeBadge.style.cssText =
                  "margin-left:4px;padding:2px 4px;background:#c8e6c9;color:#000;font-size:10px;border-radius:3px;";
                citeBadge.textContent = `Cited by ${citations}`;
                titleEl.appendChild(citeBadge);
              }
            } else {
              console.log(
                `[Scholarly] ✗ Article ${collected.length + 1}: "${title.substring(0, 50)}..." | Journal: ${journal} | Ranking: NOT FOUND`,
              );
            }
          } else {
            console.warn(
              `[Scholarly] ⚠ Article ${collected.length + 1}: Cannot search for ranking - journal="${journal}", rankings=${rankings.length}`,
            );
          }

          collected.push(article);
        }
      } catch (error) {
        console.error(`[Scholarly] Error parsing result ${index}:`, error);
      }
    });

    console.log(`[Scholarly] Total articles scraped: ${collected.length}`);
    console.log("[Scholarly] Full data:", collected);

    // Display summary
    if (collected.length > 0) {
      const withRanking = collected.filter((a) => a.ranking).length;
      const withoutRanking = collected.length - withRanking;
      console.log(
        `[Scholarly] Summary: ${withRanking} articles with rankings, ${withoutRanking} without`,
      );
    }
  } catch (error) {
    console.error("[Scholarly] Error during scraping:", error);
  }
}

/**
 * Initialize the content script logic for Google Scholar.
 * It will react to storage changes and page loads.
 */
function init(): void {
  console.log("[Scholarly] Content script initialized");
  console.log("[Scholarly] Current URL:", window.location.href);

  // only run on scholar subdomain
  if (!/scholar\.google\./i.test(window.location.hostname)) {
    console.log("[Scholarly] Not on Google Scholar domain, exiting");
    return;
  }

  console.log("[Scholarly] On Google Scholar domain, setting up listeners...");

  // helper to decide whether to scrape now
  const maybeScrape = async (enabled: boolean): Promise<void> => {
    console.log(`[Scholarly] maybeScrape called with enabled=${enabled}`);
    if (enabled) {
      console.log("[Scholarly] Scraping is enabled, starting scrape...");
      await scrapeArticles();
    } else {
      console.log("[Scholarly] Scraping is disabled");
    }
  };

  // Check initial state from storage
  getGoogleScholarEnabled()
    .then((enabled) => {
      console.log(`[Scholarly] Initial enabled state: ${enabled}`);
      return maybeScrape(enabled);
    })
    .catch((error) => {
      console.error("[Scholarly] Error checking storage:", error);
    });

  // Listen for messages from the popup when toggle changes
  if (chrome && chrome.runtime) {
    console.log("[Scholarly] Setting up runtime message listener");
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("[Scholarly] Received message:", message);
      if (message.type === "TOGGLE_CHANGED") {
        console.log(`[Scholarly] Toggle changed to: ${message.enabled}`);
        maybeScrape(Boolean(message.enabled))
          .then(() => {
            sendResponse({ received: true, success: true });
          })
          .catch((error) => {
            console.error("[Scholarly] Error during scraping:", error);
            sendResponse({ received: true, success: false, error });
          });
        return true; // Keep the channel open for async response
      }
      sendResponse({ received: true });
    });
  } else {
    console.error("[Scholarly] chrome.runtime not available");
  }
}

export { init, scrapeArticles };
