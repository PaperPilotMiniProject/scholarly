/**
 * scraper.ts — ORCID content script
 *
 * Runs on orcid.org profile pages.
 * Extracts the ORCID ID from the URL, fetches all works via the API,
 * resolves DOIs (directly from ORCID data, no Crossref fallback needed),
 * then hands enriched articles off to profileInjector for badge rendering.
 *
 * Registered in manifest.json as:
 * {
 *   "matches": ["https://orcid.org/*"],
 *   "js": ["orcid/scraper.js"],
 *   "run_at": "document_idle"
 * }
 */

/// <reference types="chrome" />

import {
  extractOrcidId,
  fetchWorkSummaries,
  fetchWorkDetail,
  type OrcidWorkDetail,
} from "./orcidApiClient";
import { getScopusRankingByDoi } from "../../utils/csvParser";
import { injectOrcidBadges, clearOrcidBadges } from "./profileInjector";
import type { S2PaperStats } from "../../services/semanticScholar";

// ─── Background Fetch Helpers ─────────────────────────────────────────────────

// Gets stats of a paper from Semantic Scholar through background script
async function getS2StatsByDoi(doi: string): Promise<S2PaperStats | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[Scholarly][ORCID] S2 fetch timed out for DOI: ${doi}`);
      resolve(null);
    }, 15000);

    chrome.runtime.sendMessage(
      { type: "SEMANTIC_SCHOLAR_FETCH", doi },
      (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response?.ok) {
          resolve(null);
          return;
        }
        resolve(response.data as S2PaperStats);
      },
    );
  });
}


// ─── Profile Owner Name ───────────────────────────────────────────────────────

/**
 * Attempts to extract the profile owner's display name from the ORCID DOM.
 * Tries multiple selectors to handle ORCID's Angular rendering quirks.
 */
function getProfileOwnerName(): string | null {
  const selectors = [
    ".fullname",
    "[id*='fullname']",
    "app-bio h2",
    ".orcid-header h2",
    "mat-card h2",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 1) {
      console.log(`[Scholarly][ORCID] Profile owner name: "${text}" (via "${sel}")`);
      return text;
    }
  }
  // Fallback: first meaningful h1/h2 that doesn't look like a site heading
  for (const h of document.querySelectorAll("h1, h2")) {
    const text = (h as HTMLElement).textContent?.trim();
    if (text && text.length > 2 && !/orcid|@|search/i.test(text)) {
      console.log(`[Scholarly][ORCID] Profile owner name (fallback): "${text}"`);
      return text;
    }
  }
  console.warn("[Scholarly][ORCID] Could not detect profile owner name from DOM");
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrcidArticle {
  putCode: number;
  title: string;
  type: string;
  year: string | null;
  doi: string | null;
  journalTitle: string | null;
  url: string | null;
  contributors: { name: string; role: string | null; sequence: string | null }[];
  scopusRanking: any | null;
  semanticScholar: SemanticScholarData | null;  // ← add this
  citations: number | null;                             // ← add this
}

export interface SemanticScholarData {
  citationCount: number;
  influentialCitationCount: number;
  referenceCount: number;
  isOpenAccess: boolean;
}

// ─── Concurrency Utility ──────────────────────────────────────────────────────

/**
 * Runs async workers over an array with a max concurrency limit.
 * Reused pattern from googlescholarprofile.ts — keeping it local
 * until we extract a shared utility.
 */

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(items[current], current);
    }
  }

  const threads = Array.from({ length: Math.max(1, limit) }, () =>
    runWorker(),
  );
  await Promise.all(threads);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ─── DOM Readiness ────────────────────────────────────────────────────────────

/**
 * ORCID profile pages are Angular-rendered and load work entries
 * asynchronously. Poll for the works section AND individual work
 * entries to appear before scraping.
 *
 * Waits up to ~30 seconds (30 attempts × 1 s) for the page to fully render.
 */
async function waitForWorksSection(
  maxAttempts = 5,
  delayMs = 1000,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const worksSection =
      document.querySelector("app-work-stack") ||     // individual work cards
      document.querySelector("#orcid-works") ||
      document.querySelector("orcid-works") ||         // Angular element tag
      document.querySelector("[id*='works']");          // fallback

    if (worksSection) {
      console.log(
        `[Scholarly][ORCID] Works section found on attempt ${attempt + 1}`,
      );
      // Wait a little longer to let remaining work entries render
      await sleep(1500);
      return true;
    }

    console.log(
      `[Scholarly][ORCID] Waiting for works section... attempt ${attempt + 1}/${maxAttempts}`,
    );
    await sleep(delayMs);
  }

  // Proceed anyway — API fetch doesn't depend on DOM being fully rendered
  console.log(
    "[Scholarly][ORCID] Works section not found after polling, proceeding with API fetch anyway",
  );
  return false;
}

// ─── Main Scrape Function ─────────────────────────────────────────────────────

/**
 * Main entry point called by init().
 * Orchestrates the full pipeline:
 *   1. Extract ORCID ID from URL
 *   2. Fetch work summaries (lightweight, no DOIs)
 *   3. Fetch work details in parallel (with DOIs)
 *   4. Bulk-lookup Scopus rankings by DOI
 *   5. Hand off to profileInjector
 */
export async function scrapeOrcidProfile(options?: {
  shouldContinue?: () => boolean;
}): Promise<void> {
  const shouldContinue = options?.shouldContinue ?? (() => true);
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    if (!shouldContinue()) return;

    try {
      await _doScrape(shouldContinue);
      return; // success — stop retrying
    } catch (error) {
      console.error(
        `[Scholarly][ORCID] Scrape attempt ${attempt}/${MAX_RETRIES} failed:`,
        error,
      );
      if (attempt < MAX_RETRIES && shouldContinue()) {
        console.log(
          `[Scholarly][ORCID] Retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error("[Scholarly][ORCID] All scrape attempts exhausted.");
}

/**
 * Internal implementation — separated so scrapeOrcidProfile can wrap it
 * in retry logic.
 */
async function _doScrape(
  shouldContinue: () => boolean,
): Promise<void> {
  // Give the ORCID Angular app a few seconds to bootstrap and render
  console.log("[Scholarly][ORCID] Waiting for page to load...");
  await sleep(3000);

  clearOrcidBadges();
  console.log("[Scholarly][ORCID] Starting ORCID profile scrape...");

  // ── Step 1: Extract ORCID ID ──────────────────────────────────────────────
  const orcidId = extractOrcidId(window.location.href);
  if (!orcidId) {
    console.log(
      "[Scholarly][ORCID] No ORCID ID found in URL, not a profile page:",
      window.location.href,
    );
    return;
  }

  console.log(`[Scholarly][ORCID] Found ORCID ID: ${orcidId}`);

  // ── Step 2: Wait for DOM ──────────────────────────────────────────────────
  await waitForWorksSection();
  if (!shouldContinue()) return;

  // ── Step 2.5: Extract profile owner name ─────────────────────────────────
  const ownerName = getProfileOwnerName();
  console.log(`[Scholarly][ORCID] Authorship tracking for: ${ownerName ?? "unknown"}`);

  // ── Step 3: Fetch work summaries ──────────────────────────────────────────
  const summaries = await fetchWorkSummaries(orcidId);

  if (!shouldContinue()) return;

  console.log(
    `[Scholarly][ORCID] Fetched ${summaries.length} work summaries`,
  );

  if (summaries.length === 0) {
    console.log("[Scholarly][ORCID] No works found for this profile.");
    return;
  }

  // ── Step 4: Fetch full details for each work (to get DOIs) ───────────────
  const relevantTypes = new Set([
    "journal-article",
    "conference-paper",
    "book-chapter",
    "book",
    "report",
  ]);

  const relevantSummaries = summaries.filter((s) =>
    relevantTypes.has(s.type),
  );

  console.log(
    `[Scholarly][ORCID] ${relevantSummaries.length} relevant works after type filter`,
  );

  // Build detail array with placeholders — filled in concurrently below
  const details: (OrcidWorkDetail | null)[] = new Array(
    relevantSummaries.length,
  ).fill(null);

  await runWithConcurrency(
    relevantSummaries,
    5,
    async (summary, index) => {
      if (!shouldContinue()) return;

      try {
        const detail = await fetchWorkDetail(orcidId, summary.putCode);
        details[index] = detail;

        console.log(
          `[Scholarly][ORCID] Detail [${index}] "${summary.title.substring(0, 50)}" → DOI: ${detail?.doi ?? "none"}`,
        );
      } catch (error) {
        console.error(
          `[Scholarly][ORCID] Failed to fetch detail for put-code ${summary.putCode}:`,
          error,
        );
      }
    },
  );

  if (!shouldContinue()) return;

  // ── Step 5: Bulk Scopus & S2 lookup by DOI ────────────────────────────────
  console.log("[Scholarly][ORCID] Fetching Scopus and Semantic Scholar stats...");

  const [scopusResults, s2Results] = await Promise.all([
    Promise.all(
      details.map((detail) =>
        detail?.doi
          ? getScopusRankingByDoi(detail.doi)
          : Promise.resolve(null),
      ),
    ),
    Promise.all(
      details.map((detail) =>
        detail?.doi
          ? getS2StatsByDoi(detail.doi)
          : Promise.resolve(null),
      ),
    ),
  ]);

  if (!shouldContinue()) return;

  // ── Step 6: Assemble enriched article objects ─────────────────────────────
  const articles: OrcidArticle[] = details.map((detail, index) => {
    const scopusRanking = scopusResults[index] ?? null;
    const semanticScholar = s2Results[index] ?? null;
    const summary = relevantSummaries[index];

    if (scopusRanking) {
      console.log(
        `[Scholarly][ORCID] ✓ Scopus match [${index}]: "${summary.title.substring(0, 50)}" → SJR ${scopusRanking.sjr}`,
      );
    } else {
      console.log(
        `[Scholarly][ORCID] ✗ No Scopus match [${index}]: "${summary.title.substring(0, 50)}"`,
      );
    }

    if (semanticScholar) {
      console.log(
        `[Scholarly][ORCID] ✓ S2 match [${index}]: "${summary.title.substring(0, 50)}" → ${semanticScholar.citationCount} citations`,
      );
    }

    return {
      putCode: summary.putCode,
      title: detail?.title ?? summary.title,
      type: detail?.type ?? summary.type,
      year: detail?.year ?? summary.year,
      doi: detail?.doi ?? null,
      journalTitle: detail?.journalTitle ?? null,
      url: detail?.url ?? null,
      contributors: detail?.contributors ?? [],
      scopusRanking,
      semanticScholar: s2Results[index] ?? null,
      citations: detail?.citations ?? null,
    };
  });

  const withRanking = articles.filter((a) => a.scopusRanking).length;
  console.log(
    `[Scholarly][ORCID] Done: ${articles.length} articles, ${withRanking} with Scopus rankings`,
  );

  // ── Step 7: Hand off to injector ──────────────────────────────────────────
  if (shouldContinue()) {
    injectOrcidBadges(articles, ownerName);
  }
}

// Init logic is handled by src/content/orcid.ts via WXT's defineContentScript.