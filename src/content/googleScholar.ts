/// <reference types="chrome" />

import { getGoogleScholarEnabled } from "../../src/utils/storage";
import { getScopusRankingByDoi } from "../../src/utils/csvParser";
import {
  clearProfileBadges,
  isGoogleScholarProfilePage,
  scrapeGoogleScholarProfile,
} from "./googlescholarprofile";

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
 * Detects if we're on a user profile page or search results page.
 */
function isUserProfilePage(): boolean {
  // User profile pages have URLs like: /citations?user=ZpBeJ_IAAAAJ&hl=en
  return (
    /\/citations/.test(window.location.pathname) &&
    /user=/.test(window.location.search)
  );
}

function buildRankingCard(ranking: any): HTMLElement {
  const card = document.createElement("div");
  card.className = "scholarly-card";
  card.style.cssText =
    "margin-top:6px;padding:10px 12px;border:1px solid #d0d7de;border-radius:8px;" +
    "box-shadow:0 6px 18px rgba(0,0,0,0.12);background:#fff;max-width:360px;font-size:12px;line-height:1.45; position: absolute; z-index: 1000;";

  const rows: Array<[string, string]> = [
    ["Journal", ranking.title || "-"],
    ["Publisher", ranking.publisher || "-"],
    ["ISSN", (ranking.issns || []).join(", ") || "-"],
    ["SJR", ranking.sjr ? `${Number(ranking.sjr).toFixed(3)} (${ranking.sjrYear || "-"})` : "-"],
    ["Quartile", ranking.sjrBestQuartile || "-"],
    ["SNIP", ranking.snip ? `${Number(ranking.snip).toFixed(3)} (${ranking.snipYear || "-"})` : "-"],
    ["CiteScore", ranking.citeScore ? `${Number(ranking.citeScore).toFixed(2)} (${ranking.citeScoreYear || "-"})` : "-"],
    ["Open Access", ranking.openAccess === "1" ? "Yes" : "No"],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;";

    const left = document.createElement("span");
    left.style.cssText = "font-weight:600;color:#111827;";
    left.textContent = label;

    const right = document.createElement("span");
    right.style.cssText = "color:#1f2937;text-align:right;";
    right.textContent = value;

    row.append(left, right);
    card.appendChild(row);
  });

  return card;
}

/**
 * Collects all visible article results from a Google Scholar search page with journal rankings.
 */
async function scrapeArticles(
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  if (!shouldContinue()) return;
  clearBadges();
  console.log("[Scholarly] Starting Google Scholar scrape...");

  try {
    // ── Phase 1: collect DOM data synchronously ──────────────────────────────
    type ArticleData = {
      titleEl: HTMLElement;
      badgeContainer: HTMLElement;
      title: string;
      link: string;
      doi: string | null;
      journal: string;
      year: string;
      citations: number;
    };

    // Determine selector based on page type
    const isProfile = isUserProfilePage();
    const selector = isProfile ? ".gsc_a_tr" : ".gs_r";

    const results = document.querySelectorAll(selector);
    console.log(
      `[Scholarly] Found ${results.length} result containers (Page type: ${isProfile ? "Profile" : "Search"})`,
    );
    const articles: ArticleData[] = [];

    results.forEach((row, index) => {
      try {
        let titleEl: HTMLElement | null = null;
        let badgeContainer: HTMLElement | null = null;
        let title = "";
        let linkEl: HTMLAnchorElement | null = null;
        let sourceEl: HTMLElement | null = null;
        let citationsCell: HTMLTableCellElement | null = null;

        if (isProfile) {
          // User profile page: table row structure (.gsc_a_tr)
          // Title and citation source are in the first cell with class gsc_a_t
          titleEl = row.querySelector(".gsc_a_t") as HTMLElement | null;
          if (!titleEl) return;

          // Extract title from the link
          const titleLink = titleEl.querySelector("a");
          if (!titleLink) return;

          title = titleLink.innerText.trim();
          if (!title) return;

          linkEl = titleLink as HTMLAnchorElement;

          badgeContainer = titleLink; // Append badges to the title link

          // Citation count is in the cell with class gsc_a_c
          citationsCell = row.querySelector(
            ".gsc_a_c",
          ) as HTMLTableCellElement | null;

          // Year is in the cell with class gsc_a_y
          const yearCell = row.querySelector(".gsc_a_y") as HTMLElement | null;
          if (yearCell) {
            const yearMatch = yearCell.innerText.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              // Year will be set later
            }
          }
        } else {
          // Search results page: .gs_r structure
          titleEl = row.querySelector(".gs_rt") as HTMLElement | null;
          if (!titleEl) return;

          title = titleEl.innerText.trim();
          if (!title) return;

          linkEl = titleEl.querySelector("a") as HTMLAnchorElement | null;
          badgeContainer = titleEl; // Append badges to title element
          sourceEl = row.querySelector(".gs_a") as HTMLElement | null;

          row.querySelectorAll(".gs_fl a").forEach((a) => {
            const t = a.textContent || "";
            if (t.startsWith("Cited by")) {
              // Will process later
            }
          });
        }

        const link = linkEl ? linkEl.href : "";
        const doi = extractDoi(link);

        let journal = "";
        let year = "";
        let citations = 0;

        if (isProfile) {
          // For profile pages, extract year from the year cell
          const yearCell = row.querySelector(".gsc_a_y") as HTMLElement | null;
          if (yearCell) {
            const yearMatch = yearCell.innerText.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) year = yearMatch[0];
          }

          // Extract citations from the citation cell
          if (citationsCell) {
            const citText = citationsCell.innerText.trim();
            if (citText) {
              const citMatch = citText.match(/\d+/);
              if (citMatch) citations = parseInt(citMatch[0], 10);
            }
          }

          // Extract journal/source info from the gray text under title
          const grayTexts = titleEl.querySelectorAll(".gs_gray");
          if (grayTexts.length > 0) {
            const sourceText = (grayTexts[grayTexts.length - 1] as HTMLElement)
              .innerText; // Usually the last gray text line
            console.log(`[Scholarly] Source text [${index}]: "${sourceText}"`);

            let parts = sourceText.split(" - ");
            if (parts.length >= 2) {
              journal = parts[0].trim();
              const yearMatch = sourceText.match(/\b(19|20)\d{2}\b/);
              if (yearMatch && !year) year = yearMatch[0];
            }
          }
        } else if (sourceEl) {
          // Search results page processing
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

        articles.push({
          titleEl,
          badgeContainer: badgeContainer!,
          title,
          link,
          doi,
          journal,
          year,
          citations,
        });
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

    if (!shouldContinue()) return;

    // ── Phase 4: match rankings and inject badges ─────────────────────────────
    const collected: Article[] = [];

    articles.forEach((a, i) => {
      const scopusRanking = scopusResults[i];
      let ranking: any = null;
      console.log(`[Scholarly] Ranking [${i}]: "${a.title.substring(0, 50)}" → ${scopusRanking}`);
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

      if (scopusRanking && shouldContinue()) {

        console.log("Scoper ranking",scopusRanking);
        const isOpenAccess =
          String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1";

        const cardToggle = document.createElement("button");
        cardToggle.type = "button";
        cardToggle.textContent = "Ranking card";
        cardToggle.className = "scholarly-badge";
        cardToggle.style.cssText =
          "margin-left:4px;padding:4px 12px;background:#ffffff;color:#0b7a75;border:1px solid #0b7a75;" +
          "font-size:11px;border-radius:999px;font-weight:700;cursor:pointer;";

        let cardEl: HTMLElement | null = null;
        cardToggle.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (cardEl && cardEl.isConnected) {
            cardEl.remove();
            cardEl = null;
            return;
          }
          cardEl = buildRankingCard(scopusRanking);
          a.badgeContainer.appendChild(cardEl);
        });
        a.badgeContainer.appendChild(cardToggle);

        const openAccessBadge = document.createElement("span");
        openAccessBadge.className = "scholarly-badge";
        openAccessBadge.style.cssText =
          "margin-left:4px;padding:2px 6px;background:" +
          (isOpenAccess ? "#2e7d32" : "#6c757d") +
          ";color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
        openAccessBadge.textContent = isOpenAccess
          ? "Open Access: Yes"
          : "Open Access: No";
        a.badgeContainer.appendChild(openAccessBadge);

        const badge = document.createElement("span");
        badge.className = "scholarly-badge";
        badge.style.cssText =
          "margin-left:8px;padding:2px 6px;background:#1976d2;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
        
        let sjrText = `SJR ${Number(scopusRanking.sjr || 0).toFixed(3)}`;
        if (scopusRanking.sjrBestQuartile) {
          sjrText += ` (${scopusRanking.sjrBestQuartile})`;
        } else if (scopusRanking.sjrYear) {
          sjrText += ` (${scopusRanking.sjrYear})`;
        }
        badge.textContent = sjrText;
        a.badgeContainer.appendChild(badge);

        // Add H-Index badge if available
        if (scopusRanking.hIndex) {
          const hIndexBadge = document.createElement("span");
          hIndexBadge.className = "scholarly-badge";
          hIndexBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#3f51b5;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          hIndexBadge.textContent = `H-Index ${scopusRanking.hIndex}`;
          a.badgeContainer.appendChild(hIndexBadge);
        }

        if (typeof scopusRanking.snip === "number") {
          const snipBadge = document.createElement("span");
          snipBadge.className = "scholarly-badge";
          snipBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#8e24aa;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          snipBadge.textContent = `SNIP ${scopusRanking.snip.toFixed(3)} (${scopusRanking.snipYear || "-"})`;
          a.badgeContainer.appendChild(snipBadge);
        }

        // Add CiteScore badge if available
        if (scopusRanking.citeScore) {
          const citeScoreBadge = document.createElement("span");
          citeScoreBadge.className = "scholarly-badge";
          citeScoreBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#4caf50;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          citeScoreBadge.textContent = `CiteScore ${scopusRanking.citeScore.toFixed(2)} (${scopusRanking.citeScoreYear})`;
          a.badgeContainer.appendChild(citeScoreBadge);
        }

        // Add citations count
        if (a.citations) {
          const citeBadge = document.createElement("span");
          citeBadge.className = "scholarly-badge";
          citeBadge.style.cssText =
            "margin-left:4px;padding:2px 6px;background:#ff9800;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
          citeBadge.textContent = `Cited by ${a.citations}`;
          a.badgeContainer.appendChild(citeBadge);
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

  let runGeneration = 0;
  const nextGeneration = (): number => {
    runGeneration += 1;
    return runGeneration;
  };

  // helper to decide whether to scrape now
  const maybeScrape = async (enabled: boolean): Promise<void> => {
    console.log(`[Scholarly] maybeScrape called with enabled=${enabled}`);
    if (enabled) {
      const currentGeneration = nextGeneration();
      const shouldContinue = () => currentGeneration === runGeneration;
      console.log("[Scholarly] Scraping is enabled, starting scrape...");
      if (isGoogleScholarProfilePage()) {
        await scrapeGoogleScholarProfile({ shouldContinue });
      } else {
        await scrapeArticles(shouldContinue);
      }
    } else {
      nextGeneration();
      console.log("[Scholarly] Scraping is disabled, clearing badges...");
      clearBadges();
      clearProfileBadges();
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
      // Fail-safe: default to enabled for first-time/edge environments.
      maybeScrape(true).catch((scrapeError) => {
        console.error("[Scholarly] Error during fallback scrape:", scrapeError);
      });
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
