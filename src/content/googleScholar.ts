/// <reference types="chrome" />

import { getGoogleScholarEnabled } from "../../src/utils/storage";
import { getScopusRankingByDoi } from "../../src/utils/csvParser";

interface Article {
  title: string;
  link: string;
  journal?: string;
  year?: string;
  citations?: number;
  ranking?: any;
  scopusRanking?: any;
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

    // ── Phase 2: log extracted title -> DOI mapping ───────────────────────────
    articles.forEach((a, i) => {
      console.log(
        `[Scholarly] Title -> DOI [${i}]: "${a.title}" -> ${a.doi || "No DOI found"}`,
      );
    });

    // ── Phase 3: fetch Scopus rankings via DOI only ────────────────────────────
    console.log(
      "[Scholarly] Fetching Scopus rankings by DOI for all articles...",
    );
    const scopusResults = await Promise.all(
      articles.map((a) =>
        a.doi ? getScopusRankingByDoi(a.doi) : Promise.resolve(null),
      ),
    );

    // ── Phase 4: match rankings and inject badges ─────────────────────────────
    const collected: Article[] = [];

    articles.forEach((a, i) => {
      const scopusRanking = scopusResults[i];
      let ranking: any = null;

      if (scopusRanking) {
        ranking = scopusRanking;
        console.log(
          `[Scholarly] ✓ Scopus ranking [${i}]: "${a.title.substring(0, 50)}" → ${ranking.title} | ISSN: ${(ranking.issns || []).join(", ") || "N/A"} | SJR: ${ranking.sjr ?? "N/A"} (${ranking.sjrYear ?? "N/A"}) | SNIP: ${ranking.snip ?? "N/A"} (${ranking.snipYear ?? "N/A"})`,
        );
      } else {
        console.log(
          `[Scholarly] ✗ No Scopus ranking [${i}]: "${a.title.substring(0, 50)}"`,
        );
      }

      const article: Article = {
        title: a.title,
        link: a.link,
        journal: a.journal,
        year: a.year,
        citations: a.citations,
        ranking: scopusRanking ?? undefined,
        scopusRanking: scopusRanking ?? undefined,
        extra: {},
      };

      if (scopusRanking) {
        const badge = document.createElement("span");
        badge.className = "scholarly-badge";
        badge.style.cssText =
          "margin-left:8px;padding:2px 6px;background:#1976d2;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
        badge.textContent = `SJR ${Number(scopusRanking.sjr || 0).toFixed(3)} (${scopusRanking.sjrYear || "-"})`;

        a.titleEl.appendChild(badge);

        if (typeof scopusRanking.snip === "number") {
          const snipBadge = document.createElement("span");
          snipBadge.className = "scholarly-badge";
          snipBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#8e24aa;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          snipBadge.textContent = `SNIP ${scopusRanking.snip.toFixed(3)} (${scopusRanking.snipYear || "-"})`;
          a.titleEl.appendChild(snipBadge);
        }

        // Add CiteScore badge if available
        if (scopusRanking.citeScore) {
          const citeScoreBadge = document.createElement("span");
          citeScoreBadge.className = "scholarly-badge";
          citeScoreBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#4caf50;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          citeScoreBadge.textContent = `CiteScore ${scopusRanking.citeScore.toFixed(2)} (${scopusRanking.citeScoreYear})`;
          a.titleEl.appendChild(citeScoreBadge);
        }

        // Add citations count
        if (a.citations) {
          const citeBadge = document.createElement("span");
          citeBadge.className = "scholarly-badge";
          citeBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#ff9800;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          citeBadge.textContent = `Cited by ${a.citations}`;
          a.titleEl.appendChild(citeBadge);
        }
      }

      collected.push(article);
    });

    const withScopus = collected.filter((a) => a.scopusRanking).length;
    console.log(
      `[Scholarly] Done: ${collected.length} articles, ${withScopus} with Scopus rankings`,
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
