/// <reference types="chrome" />

/**
 * Fetches journal ranking from Scopus Serial API using DOI.
 * This is the primary lookup path to avoid DOI -> CrossRef -> ISSN chaining.
 */
export async function getScopusRankingByDoi(doi: string): Promise<any | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_SCOPUS_RANKING_BY_DOI", doi },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          if (response?.error) {
            console.warn(
              `[Scholarly] Scopus DOI lookup failed for ${doi}: ${response.error}`,
            );
          }
          resolve(null);
          return;
        }
        resolve(response.ranking || null);
      },
    );
  });
}

/**
 * Fetches journal ranking from Scopus Serial API using ISSN
 * Returns real-time ranking data with SJR, SNIP, and CiteScore metrics
 */
export async function getScopusRankingByIssn(
  issn: string,
): Promise<any | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "FETCH_SCOPUS_RANKING", issn },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          if (response?.error) {
            console.warn(`[Scholarly] Scopus lookup failed: ${response.error}`);
          }
          resolve(null);
          return;
        }
        resolve(response.ranking || null);
      },
    );
  });
}

/**
 * Tries each ISSN sequentially until Scopus returns a result.
 * CrossRef returns both print and electronic ISSNs; either one may be in Scopus.
 */
export async function getScopusRankingByIssns(
  issns: string[],
): Promise<any | null> {
  for (const issn of issns) {
    const ranking = await getScopusRankingByIssn(issn);
    if (ranking) {
      console.log(`[Scholarly] Scopus hit on ISSN ${issn}`);
      return ranking;
    }
  }
  return null;
}
