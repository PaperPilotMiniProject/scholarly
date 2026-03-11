/// <reference types="chrome" />

import { getGoogleScholarEnabled } from "../../src/utils/storage";
import {
  loadSJRData,
  findRanking,
  findRankingByIssn,
  getIssnsByDoi,
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
 * Removes all ranking badges injected by Scholarly from the page.
 */
function clearBadges(): void {
  document.querySelectorAll(".scholarly-badge").forEach((el) => el.remove());
  console.log("[Scholarly] Badges cleared");
}

/**
 * Extracts a DOI from a URL, e.g. https://www.pnas.org/doi/10.1073/pnas.xxx
 */
function extractDoi(link: string): string | null {
  const match = link.match(/\b(10\.\d{4,}\/\S+)/);
  if (!match) return null;
  // strip trailing punctuation that may have been captured
  return match[1].replace(/[.,;)\]]+$/, "");
}

/**
 * Collects all visible article results from a Google Scholar search page with journal rankings.
 */
async function scrapeArticles(): Promise<void> {
  clearBadges();
  console.log("[Scholarly] Starting Google Scholar scrape...");

  try {
    const rankings = await loadSJRData();
    console.log(`[Scholarly] Rankings loaded: ${rankings.length}`);
    if (rankings.length === 0) {
      console.warn(
        "[Scholarly] No rankings data loaded - CSV may not be accessible",
      );
    }

    // ── Phase 1: collect DOM data synchronously ──────────────────────────────
    type ArticleData = {
      titleEl: HTMLElement;
      title: string;
      link: string;
      doi: string | null;
      journal: string;
      year: string;
      citations: number;
    };

    const results = document.querySelectorAll(".gs_r");
    console.log(`[Scholarly] Found ${results.length} result containers`);
    const articles: ArticleData[] = [];

    results.forEach((row, index) => {
      try {
        const titleEl = row.querySelector(".gs_rt") as HTMLElement | null;
        if (!titleEl) return;

        const title = titleEl.innerText.trim();
        if (!title) return;

        const linkEl = titleEl.querySelector("a") as HTMLAnchorElement | null;
        const link = linkEl ? linkEl.href : "";
        const doi = extractDoi(link);

        let journal = "";
        let year = "";
        let citations = 0;

        const sourceEl = row.querySelector(".gs_a") as HTMLElement | null;
        if (sourceEl) {
          const sourceText = sourceEl.innerText;
          console.log(`[Scholarly] Source text [${index}]: "${sourceText}"`);

          row.querySelectorAll(".gs_fl a").forEach((a) => {
            const t = a.textContent || "";
            if (t.startsWith("Cited by")) {
              const num = parseInt(t.replace(/[^0-9]/g, ""), 10);
              if (!isNaN(num)) citations = num;
            }
          });

          let parts = sourceText.split(" - ");
          if (parts.length >= 2) {
            let potentialJournal = parts[1].trim();
            potentialJournal = potentialJournal
              .replace(/,?\s*\d{4}\s*$/, "")
              .trim();
            potentialJournal = potentialJournal.replace(/,+$/, "").trim();
            journal = potentialJournal;
            const yearMatch = sourceText.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) year = yearMatch[0];
          } else {
            parts = sourceText.split(",");
            if (parts.length >= 2) {
              journal = parts[1]
                .trim()
                .replace(/,?\s*\d{4}\s*$/, "")
                .trim();
            }
          }
        }

        articles.push({ titleEl, title, link, doi, journal, year, citations });
      } catch (error) {
        console.error(`[Scholarly] Error parsing result ${index}:`, error);
      }
    });

    // ── Phase 2: parallel CrossRef ISSN lookups ───────────────────────────────
    const issnResults = await Promise.all(
      articles.map((a) =>
        a.doi ? getIssnsByDoi(a.doi) : Promise.resolve(null),
      ),
    );

    // ── Phase 3: match rankings and inject badges ─────────────────────────────
    const collected: Article[] = [];

    articles.forEach((a, i) => {
      const issns = issnResults[i];
      let ranking: JournalRanking | null = null;

      // Try ISSN-based match first (exact, no false positives)
      if (issns && issns.length > 0 && rankings.length > 0) {
        ranking = findRankingByIssn(issns, rankings);
        if (ranking) {
          console.log(
            `[Scholarly] ✓ ISSN match [${i}]: "${a.title.substring(0, 50)}" → ${ranking.title}`,
          );
        }
      }

      // Fall back to title-based match when no DOI / CrossRef returned nothing
      // But SKIP if journal name looks truncated or suspiciously short
      const isJournalNameReliable =
        a.journal.length > 5 && !a.journal.endsWith("...");
      if (
        !ranking &&
        a.journal &&
        rankings.length > 0 &&
        isJournalNameReliable
      ) {
        console.log(
          `[Scholarly] Attempting fuzzy match for journal: "${a.journal}"`,
        );
        ranking = findRanking(a.journal, rankings);
        if (ranking) {
          console.log(
            `[Scholarly] ✓ Title match [${i}]: "${a.title.substring(0, 50)}" | "${a.journal}" → ${ranking.title} (ISSN: ${ranking.issns?.join(", ") || "none"})`,
          );
        } else {
          console.log(`[Scholarly] ✗ No match [${i}]: journal="${a.journal}"`);
        }
      } else if (!ranking && a.journal) {
        console.log(
          `[Scholarly] ⚠ Skipped fuzzy match [${i}]: journal name too short/incomplete: "${a.journal}"`,
        );
      }

      const article: Article = {
        title: a.title,
        link: a.link,
        journal: a.journal,
        year: a.year,
        citations: a.citations,
        ranking: ranking ?? undefined,
        extra: {},
      };

      if (ranking) {
        const badge = document.createElement("span");
        badge.className = "scholarly-badge";
        badge.style.cssText =
          "margin-left:8px;padding:2px 4px;background:#ffeb3b;color:#000;font-size:10px;border-radius:3px;";
        badge.textContent = `SJR ${ranking.sjr} (Q${ranking.quartile})`;
        a.titleEl.appendChild(badge);

        if (a.citations) {
          const citeBadge = document.createElement("span");
          citeBadge.className = "scholarly-badge";
          citeBadge.style.cssText =
            "margin-left:4px;padding:2px 4px;background:#c8e6c9;color:#000;font-size:10px;border-radius:3px;";
          citeBadge.textContent = `Cited by ${a.citations}`;
          a.titleEl.appendChild(citeBadge);
        }
      }

      collected.push(article);
    });

    const withRanking = collected.filter((a) => a.ranking).length;
    console.log(
      `[Scholarly] Done: ${collected.length} articles, ${withRanking} with rankings, ${collected.length - withRanking} without`,
    );
    console.log("[Scholarly] Full data:", collected);
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
      console.log("[Scholarly] Scraping is disabled, clearing badges...");
      clearBadges();
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

export { init, scrapeArticles, clearBadges };
