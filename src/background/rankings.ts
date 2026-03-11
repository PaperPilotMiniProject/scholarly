/// <reference types="chrome" />

interface JournalRanking {
  rank: number;
  title: string;
  issns: string[];
  sjr: number;
  quartile: string;
  hjIndex: number;
  category: string;
}

let cachedRankings: JournalRanking[] | null = null;

/**
 * Loads the SJR CSV file and parses it
 */
async function loadRankings(): Promise<JournalRanking[]> {
  if (cachedRankings) {
    console.log("[Scholarly BG] Returning cached rankings");
    return cachedRankings;
  }

  try {
    console.log("[Scholarly BG] Loading SJR rankings from CSV...");
    const csvUrl = chrome.runtime.getURL("data/scimagojr 2024.csv");
    console.log(`[Scholarly BG] Fetching from: ${csvUrl}`);

    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvContent = await response.text();
    console.log(`[Scholarly BG] CSV loaded, size: ${csvContent.length} bytes`);
    console.log("[Scholarly BG] Parsing CSV...");

    cachedRankings = parseCSV(csvContent);
    console.log(
      `[Scholarly BG] Parsed ${cachedRankings.length} journal rankings`,
    );

    if (cachedRankings.length > 0) {
      console.log(
        "[Scholarly BG] Sample:",
        cachedRankings.slice(0, 2).map((r) => `${r.rank}. ${r.title}`),
      );
    }

    return cachedRankings;
  } catch (error) {
    console.error("[Scholarly BG] Error loading rankings:", error);
    return [];
  }
}

/**
 * Parses semicolon-delimited CSV with proper quoted field handling
 */
function parseCSV(content: string): JournalRanking[] {
  const lines = content.split("\n");
  if (lines.length < 2) {
    console.error("[Scholarly BG] CSV has less than 2 lines");
    return [];
  }

  // Parse header line
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  const rankIndex = headers.indexOf("Rank");
  const titleIndex = headers.indexOf("Title");
  const issnIndex = headers.indexOf("Issn");
  const sjrIndex = headers.indexOf("SJR");
  const quartileIndex = headers.indexOf("SJR Best Quartile");
  const hIndexIndex = headers.indexOf("H index");
  const categoriesIndex = headers.indexOf("Categories");

  if (
    rankIndex === -1 ||
    titleIndex === -1 ||
    sjrIndex === -1 ||
    quartileIndex === -1
  ) {
    console.error(
      "[Scholarly BG] CSV headers not found. Found:",
      headers.slice(0, 5),
    );
    return [];
  }

  const rankings: JournalRanking[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    try {
      const row = parseCSVLine(lines[i]);
      if (row.length === 0) continue;

      const rank = parseInt(row[rankIndex] || "0", 10);
      const title = (row[titleIndex] || "").replace(/^"(.*)"$/, "$1");
      const issnRaw = (row[issnIndex] || "").replace(/^"(.*)"$/, "$1");
      const issns = issnRaw
        .split(",")
        .map((s) => s.trim().replace(/-/g, ""))
        .filter(Boolean);
      const sjrStr = (row[sjrIndex] || "").replace(/,/, ".");
      const sjr = parseFloat(sjrStr);
      const quartile = (row[quartileIndex] || "").trim();
      const hjIndex = parseInt(row[hIndexIndex] || "0", 10);
      const category = (row[categoriesIndex] || "").replace(/^"(.*)"$/, "$1");

      if (title && !isNaN(sjr)) {
        rankings.push({
          rank,
          title,
          issns,
          sjr,
          quartile,
          hjIndex,
          category,
        });
      }
    } catch (error) {
      if (i < 5) {
        console.error(`[Scholarly BG] Error parsing line ${i}:`, error);
      }
    }
  }

  return rankings;
}

/**
 * Parses a CSV line handling quoted fields with semicolon delimiters
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ";" && !inQuotes) {
      // Field separator (outside quotes)
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  // Add final field
  result.push(current.trim());
  return result;
}

/**
 * Message handler for loading rankings from content script
 */
if (chrome && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "LOAD_RANKINGS") {
      console.log("[Scholarly BG] Received LOAD_RANKINGS request");
      loadRankings()
        .then((rankings) => {
          console.log(
            `[Scholarly BG] Sending ${rankings.length} rankings to content script`,
          );
          sendResponse({ success: true, data: rankings });
        })
        .catch((error) => {
          console.error("[Scholarly BG] Error in LOAD_RANKINGS:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    if (message.type === "LOOKUP_ISSN_BY_DOI") {
      const doi: string = message.doi;
      console.log(`[Scholarly BG] CrossRef lookup for DOI: ${doi}`);
      fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
        .then((r) => r.json())
        .then((data) => {
          const issns: string[] = (data.message?.ISSN || []).map(
            (issn: string) => issn.replace(/-/g, ""),
          );
          console.log(`[Scholarly BG] CrossRef ISSNs for ${doi}:`, issns);
          sendResponse({ success: true, issns });
        })
        .catch((err) => {
          console.warn(
            `[Scholarly BG] CrossRef lookup failed for ${doi}:`,
            err.message,
          );
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
  });
}

export { loadRankings };
