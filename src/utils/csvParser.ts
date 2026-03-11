/// <reference types="chrome" />

export interface JournalRanking {
  rank: number;
  title: string;
  issns?: string[];
  sjr: number;
  quartile: string;
  hjIndex: number;
  category: string;
  // ability to hold multiple sources or fallback info
  sources?: Record<string, any>;
}

/**
 * Loads SJR rankings from background script
 * The background handles loading and parsing the CSV with papaparse
 */
export async function loadSJRData(): Promise<JournalRanking[]> {
  try {
    console.log(
      "[Scholarly] Requesting SJR rankings from background script...",
    );

    return new Promise((resolve, reject) => {
      // Send message to background script
      chrome.runtime.sendMessage({ type: "LOAD_RANKINGS" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[Scholarly] Background connection error:",
            chrome.runtime.lastError.message,
          );
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response) {
          console.error("[Scholarly] No response from background");
          reject(new Error("No response from background"));
          return;
        }

        if (response.success) {
          console.log(
            `[Scholarly] Received ${response.data.length} rankings from background`,
          );
          resolve(response.data);
        } else {
          console.error("[Scholarly] Background error:", response.error);
          reject(new Error(response.error));
        }
      });
    });
  } catch (error) {
    console.error("[Scholarly] Error loading SJR data:", error);
    return [];
  }
}

/**
 * Converts parsed CSV data to JournalRanking objects
 */
function convertToRankings(data: any[]): JournalRanking[] {
  const rankings: JournalRanking[] = [];

  for (const row of data) {
    try {
      if (!row.Title || !row.SJR) continue;

      const rank = parseInt(row.Rank || "0", 10);
      const title = (row.Title || "").replace(/^"(.*)"$/, "$1");
      const sjrStr = (row.SJR || "").replace(/,/, ".");
      const sjr = parseFloat(sjrStr);
      const quartile = (row["SJR Best Quartile"] || "").trim();
      const hjIndex = parseInt(row["H index"] || "0", 10);
      const category = (row.Categories || "").replace(/^"(.*)"$/, "$1");

      if (title && !isNaN(sjr)) {
        rankings.push({
          rank,
          title,
          sjr,
          quartile,
          hjIndex,
          category,
          sources: { csvRow: row },
        });
      }
    } catch (error) {
      console.error("[Scholarly] Error converting row:", error);
    }
  }

  return rankings;
}

/**
 * Finds ranking by matching ISSN numbers (exact, no false positives).
 * ISSNs should be provided without hyphens.
 */
export function findRankingByIssn(
  issns: string[],
  rankings: JournalRanking[],
): JournalRanking | null {
  if (!issns || issns.length === 0 || rankings.length === 0) return null;
  const needle = new Set(issns.map((i) => i.replace(/-/g, "").toLowerCase()));
  for (const ranking of rankings) {
    for (const rankingIssn of ranking.issns || []) {
      if (needle.has(rankingIssn.toLowerCase())) {
        console.log(
          `[Scholarly] ISSN match: ${ranking.title} (ISSN ${rankingIssn})`,
        );
        return ranking;
      }
    }
  }
  return null;
}

/**
 * Asks the background script to look up ISSNs for a DOI via the CrossRef API.
 */
export async function getIssnsByDoi(doi: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "LOOKUP_ISSN_BY_DOI", doi },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          resolve(null);
          return;
        }
        resolve((response.issns as string[]) || null);
      },
    );
  });
}

/**
 * Finds ranking for a given journal title
 * Uses fuzzy matching with strict word-count requirements to avoid false positives
 */
export function findRanking(
  journalTitle: string,
  rankings: JournalRanking[],
): JournalRanking | null {
  if (!journalTitle || rankings.length === 0) return null;

  const normalized = normalizeTitle(journalTitle);
  console.log(
    `[Scholarly] Looking for ranking for: "${journalTitle}" (normalized: "${normalized}")`,
  );

  // First try exact match (normalized)
  for (const ranking of rankings) {
    if (normalizeTitle(ranking.title) === normalized) {
      console.log(`[Scholarly] Found exact match: ${ranking.title}`);
      return ranking;
    }
  }

  // Then try substring match (one must fully contain the other)
  for (const ranking of rankings) {
    const rankingTitle = normalizeTitle(ranking.title);
    if (
      rankingTitle.includes(normalized) ||
      normalized.includes(rankingTitle)
    ) {
      console.log(`[Scholarly] Found substring match: ${ranking.title}`);
      return ranking;
    }
  }

  // Try word overlap matching - ONLY if we have enough word matches
  // Require ≥90% of search words to be found in the ranking title
  const searchWords = normalized.split(" ").filter((w) => w.length > 3);
  if (searchWords.length >= 2) {
    // Only attempt if we have 2+ significant words
    for (const ranking of rankings) {
      const rankingTitle = normalizeTitle(ranking.title);
      const rankingWords = rankingTitle.split(" ");
      const matchCount = searchWords.filter((w) =>
        rankingWords.some((rw) => rw.includes(w) || w.includes(rw)),
      ).length;
      // Much stricter: require ≥90% match or all words
      const matchRatio = matchCount / searchWords.length;
      if (matchRatio >= 0.9) {
        console.log(
          `[Scholarly] Found strong match (${matchCount}/${searchWords.length} words): ${ranking.title}`,
        );
        return ranking;
      }
    }
  }

  console.log(`[Scholarly] No ranking found for: "${journalTitle}"`);
  return null;
}

/**
 * Normalizes journal titles for comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
