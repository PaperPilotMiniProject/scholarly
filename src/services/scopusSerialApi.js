/**
 * Scopus Serial API Service
 * Fetches journal ranking and metrics from Scopus using ISSN
 */

/**
 * Fetches ranking data from Scopus Serial API for a given ISSN
 * @param {string} issn - The ISSN number (with or without hyphens)
 * @returns {Promise<Object|null>} The parsed Scopus ranking data or null if not found
 */
export async function fetchScopusRankingByIssn(issn) {
  try {
    // Get API credentials from chrome storage
    const { scopusApiKey, scopusInstToken } = await getApiCredentials();

    if (!scopusApiKey) {
      console.error(
        "[Scholarly] Scopus API key not configured. Please set SCOPUS_API_KEY in environment.",
      );
      return null;
    }

    // Normalize ISSN (remove hyphens if present)
    const normalizedIssn = issn.replace(/-/g, "");

    console.log(
      `[Scholarly] Fetching Scopus ranking for ISSN: ${normalizedIssn}`,
    );

    // Build API URL
    const baseUrl = "https://api.elsevier.com/content/serial/title/issn";
    const params = new URLSearchParams({
      apikey: scopusApiKey,
      view: "ENHANCED",
    });

    // Add institution token if available
    if (scopusInstToken) {
      params.append("insttoken", scopusInstToken);
    }

    const url = `${baseUrl}/${normalizedIssn}?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 401) {
        console.error(
          "[Scholarly] Scopus API authentication failed. Check API key.",
        );
      } else if (response.status === 404) {
        console.warn(`[Scholarly] ISSN ${normalizedIssn} not found in Scopus`);
      } else {
        console.error(`[Scholarly] Scopus API error: ${response.status}`);
      }
      return null;
    }

    const data = await response.json();

    if (!data["serial-metadata-response"]?.entry?.[0]) {
      console.warn(`[Scholarly] No data returned for ISSN ${normalizedIssn}`);
      return null;
    }

    const entry = data["serial-metadata-response"].entry[0];
    const ranking = parseScopusEntry(entry);

    console.log(`[Scholarly] ✓ Scopus ranking found for ${ranking.title}`);

    return ranking;
  } catch (error) {
    console.error("[Scholarly] Error fetching Scopus ranking:", error);
    return null;
  }
}

/**
 * Parses a Scopus serial API response entry into ranking object
 * @param {Object} entry - The entry from serial-metadata-response
 * @returns {Object} Parsed ranking data with SJR, SNIP, CiteScore
 */
function parseScopusEntry(entry) {
  const ranking = {
    title: entry["dc:title"] || "Unknown",
    issn: entry["prism:issn"] || "",
    publisher: entry["dc:publisher"] || "",
    coverageStartYear: entry["coverageStartYear"] || "",
    coverageEndYear: entry["coverageEndYear"] || "",
    aggregationType: entry["prism:aggregationType"] || "",
    openAccess: entry["openaccess"] || "0",
  };

  // Extract current SJR
  if (entry.SJRList?.SJR) {
    const sjrArray = Array.isArray(entry.SJRList.SJR)
      ? entry.SJRList.SJR
      : [entry.SJRList.SJR];

    // Get the most recent SJR
    if (sjrArray.length > 0) {
      const latestSjr = sjrArray[sjrArray.length - 1];
      ranking.sjr = parseFloat(latestSjr["$"]);
      ranking.sjrYear = latestSjr["@year"];
    }
  }

  // Extract current SNIP
  if (entry.SNIPList?.SNIP) {
    const snipArray = Array.isArray(entry.SNIPList.SNIP)
      ? entry.SNIPList.SNIP
      : [entry.SNIPList.SNIP];

    if (snipArray.length > 0) {
      const latestSnip = snipArray[snipArray.length - 1];
      ranking.snip = parseFloat(latestSnip["$"]);
      ranking.snipYear = latestSnip["@year"];
    }
  }

  // Extract CiteScore metrics
  if (entry.citeScoreYearInfoList) {
    ranking.citeScore = parseFloat(
      entry.citeScoreYearInfoList.citeScoreCurrentMetric || 0,
    );
    ranking.citeScoreYear =
      entry.citeScoreYearInfoList.citeScoreCurrentMetricYear;
    ranking.citeScoreTracker = parseFloat(
      entry.citeScoreYearInfoList.citeScoreTracker || 0,
    );
    ranking.citeScoreTrackerYear =
      entry.citeScoreYearInfoList.citeScoreTrackerYear;
  }

  // Extract subject areas
  if (entry["subject-area"]) {
    const areas = Array.isArray(entry["subject-area"])
      ? entry["subject-area"]
      : [entry["subject-area"]];
    ranking.subjectAreas = areas.map((area) => ({
      code: area["@code"],
      abbrev: area["@abbrev"],
      name: area["$"],
    }));
  }

  // Store full Scopus response for future use
  ranking.scopusMeta = entry;
  ranking.source = "scopus";

  return ranking;
}

/**
 * Gets API credentials from chrome storage
 * @returns {Promise<Object>} Object with scopusApiKey and scopusInstToken
 */
export async function getApiCredentials() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["scopusApiKey", "scopusInstToken"], (items) => {
      resolve({
        scopusApiKey: items.scopusApiKey || "",
        scopusInstToken: items.scopusInstToken || "",
      });
    });
  });
}

/**
 * Saves API credentials to chrome storage
 * @param {string} apiKey - Scopus API key
 * @param {string} instToken - Scopus institution token (optional)
 */
export async function setApiCredentials(apiKey, instToken = "") {
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      {
        scopusApiKey: apiKey,
        scopusInstToken: instToken,
      },
      () => {
        console.log("[Scholarly] API credentials saved");
        resolve();
      },
    );
  });
}

/**
 * Formats ranking data for display
 * @param {Object} ranking - The ranking object from parseScopusEntry
 * @returns {string} Formatted string with key metrics
 */
export function formatRankingDisplay(ranking) {
  const parts = [];

  if (ranking.sjr) {
    parts.push(`SJR: ${ranking.sjr.toFixed(3)} (${ranking.sjrYear})`);
  }

  if (ranking.snip) {
    parts.push(`SNIP: ${ranking.snip.toFixed(3)} (${ranking.snipYear})`);
  }

  if (ranking.citeScore) {
    parts.push(
      `CiteScore: ${ranking.citeScore.toFixed(2)} (${ranking.citeScoreYear})`,
    );
  }

  return parts.length > 0 ? parts.join(" | ") : "No metrics available";
}
