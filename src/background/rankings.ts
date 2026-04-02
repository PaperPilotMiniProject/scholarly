/// <reference types="chrome" />

type LocalSjrData = {
  rank: string;
  hIndex: string;
  sjrBestQuartile: string;
  title: string;
};

let localSjrMap: Map<string, LocalSjrData> | null = null;
let isLoadingLocalSjr = false;

if (chrome && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    if (message.type === "FETCH_SCOPUS_RANKING") {
      const issn: string = message.issn;
      console.log(`[Scholarly BG] Scopus ranking lookup for ISSN: ${issn}`);

      if (!chrome.storage?.local) {
        sendResponse({
          success: false,
          error: "Chrome storage is unavailable in background context.",
        });
        return;
      }

      // Get API credentials from chrome storage
      chrome.storage.local.get(["scopusApiKey", "scopusInstToken"], (items) => {
        const apiKey = (items.scopusApiKey || "") as string;
        const instToken = (items.scopusInstToken || "") as string;

        if (!apiKey) {
          console.error("[Scholarly BG] Scopus API key not configured");
          sendResponse({
            success: false,
            error:
              "Scopus API key not configured. Please configure it in extension settings.",
          });
          return;
        }

        const digitsOnlyIssn = issn.replace(/-/g, "");
        const hyphenatedIssn =
          digitsOnlyIssn.length === 8
            ? `${digitsOnlyIssn.slice(0, 4)}-${digitsOnlyIssn.slice(4)}`
            : issn;

        const baseUrl = "https://api.elsevier.com/content/serial/title/issn";
        const params = new URLSearchParams({
          apikey: apiKey,
          view: "ENHANCED",
        });

        if (instToken) {
          params.append("insttoken", instToken);
        }

        const candidates = [hyphenatedIssn, digitsOnlyIssn].filter(Boolean);

        const tryFetch = async () => {
          for (const candidateIssn of candidates) {
            const url = `${baseUrl}/${candidateIssn}?${params.toString()}`;
            console.log(
              `[Scholarly BG] Scopus request URL ISSN: ${candidateIssn}`,
            );

            try {
              const response = await fetch(url, {
                headers: {
                  Accept: "application/json",
                },
              });
              const data = await response.json();
              const entry = data["serial-metadata-response"]?.entry?.[0];

              if (entry) {
                let ranking = parseScopusEntry(entry);
                ranking = await augmentWithLocalSjr(ranking);
                console.log(
                  `[Scholarly BG] Scopus ranking found for ${candidateIssn}: ${ranking.title}`,
                );
                sendResponse({ success: true, ranking });
                return;
              }

              const serviceError =
                data["service-error"]?.status?.statusText ||
                data["service-error"]?.statusText ||
                data["service-error"]?.message ||
                "Unknown Scopus response shape";
              console.warn(
                `[Scholarly BG] No Scopus data for ISSN candidate ${candidateIssn}. HTTP ${response.status}. ${serviceError}`,
              );
            } catch (err: any) {
              console.error(
                `[Scholarly BG] Scopus lookup failed for ${candidateIssn}:`,
                err?.message || String(err),
              );
            }
          }

          sendResponse({
            success: false,
            error: `ISSN not found in Scopus for candidates: ${candidates.join(", ")}`,
          });
        };

        tryFetch();
      });

      return true;
    }

    if (message.type === "FETCH_SCOPUS_RANKING_BY_DOI") {
      const doi: string = message.doi;
      console.log(`[Scholarly BG] Scopus ranking lookup for DOI: ${doi}`);

      if (!chrome.storage?.local) {
        sendResponse({
          success: false,
          error: "Chrome storage is unavailable in background context.",
        });
        return;
      }

      chrome.storage.local.get(["scopusApiKey", "scopusInstToken"], (items) => {
        const apiKey = (items.scopusApiKey || "") as string;
        const instToken = (items.scopusInstToken || "") as string;

        if (!apiKey) {
          sendResponse({
            success: false,
            error:
              "Scopus API key not configured. Please configure it in extension settings.",
          });
          return;
        }

        fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
          .then((r) => r.json())
          .then(async (data) => {
            const issns: string[] = data.message?.ISSN || [];
            if (!issns.length) {
              sendResponse({ success: false, error: "No ISSN found in CrossRef for DOI" });
              return;
            }

            const params = new URLSearchParams({
              apikey: apiKey,
              view: "ENHANCED",
            });
            if (instToken) {
              params.append("insttoken", instToken);
            }

            const baseUrl = "https://api.elsevier.com/content/serial/title/issn";
            let candidates: string[] = [];
            
            issns.forEach(issn => {
                const digitsOnly = issn.replace(/-/g, "");
                const hyphenated = digitsOnly.length === 8 ? `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4)}` : issn;
                if (hyphenated) candidates.push(hyphenated);
                if (digitsOnly) candidates.push(digitsOnly);
            });
            candidates = [...new Set(candidates)];

            for (const candidateIssn of candidates) {
              const url = `${baseUrl}/${candidateIssn}?${params.toString()}`;
              try {
                const response = await fetch(url, {
                  headers: { Accept: "application/json" },
                });
                const rData = await response.json();
                const entry = rData["serial-metadata-response"]?.entry?.[0];

                if (entry) {
                  let ranking = parseScopusEntry(entry);
                  ranking.doi = doi;
                  ranking = await augmentWithLocalSjr(ranking);
                  console.log(
                    `[Scholarly BG] Scopus DOI ranking found via ISSN ${candidateIssn}: ${ranking.title}`,
                  );
                  sendResponse({ success: true, ranking });
                  return;
                }
              } catch (err: any) {
                console.warn(`[Scholarly BG] Failed looking up ISSN ${candidateIssn}:`, err);
              }
            }

            sendResponse({ success: false, error: "No Scopus ranking found for derived ISSNs." });
          })
          .catch((err) => {
            sendResponse({ success: false, error: `CrossRef error: ${err.message}` });
          });
      });

      return true;
    }
    if (message.type === "FETCH_SCOPUS_ABSTRACT_BY_DOI") {
      const doi: string = message.doi;
      console.log(`[Scholarly BG] Scopus abstract retrieval for DOI: ${doi}`);

      if (!chrome.storage?.local) {
        sendResponse({
          success: false,
          error: "Chrome storage is unavailable in background context.",
        });
        return;
      }

      chrome.storage.local.get(["scopusApiKey", "scopusInstToken"], (items) => {
        const apiKey = (items.scopusApiKey || "") as string;
        const instToken = (items.scopusInstToken || "") as string;

        if (!apiKey) {
          sendResponse({
            success: false,
            error:
              "Scopus API key not configured. Please configure it in extension settings.",
          });
          return;
        }

        const params = new URLSearchParams({
          apikey: apiKey,
          httpAccept: "application/json",
        });
        if (instToken) {
          params.append("insttoken", instToken);
        }

        const url = `https://api.elsevier.com/content/abstract/doi/${encodeURIComponent(doi)}?${params.toString()}`;
        console.log(`[Scholarly BG] Scopus abstract request URL DOI: ${doi}`);

        fetch(url, {
          headers: {
            "Accept": "application/json"
          }
        })
          .then(async (r) => {
            const text = await r.text();
            if (!r.ok) {
              console.warn(`[Scholarly BG] Scopus abstract HTTP error ${r.status} for ${doi}. Response: ${text.substring(0, 200)}`);
              throw new Error(`Scopus API error ${r.status}`);
            }
            try {
              return JSON.parse(text);
            } catch (e) {
              console.error(`[Scholarly BG] JSON parse failed for DOI ${doi}. Response starts with: ${text.substring(0, 100)}`);
              throw new Error("Invalid JSON response from Scopus");
            }
          })
          .then((data) => {
            const head = data["abstracts-retrieval-response"]?.item?.bibrecord?.head;
            const correspondence = head?.correspondence;
            const authorGroup = head?.["author-group"];
            
            if (!correspondence && !authorGroup) {
              console.warn(`[Scholarly BG] Author data missing in Scopus response for DOI: ${doi}`);
              // Log the keys to see what we DID get
              console.log("[Scholarly BG] Response keys:", Object.keys(data));
              sendResponse({ 
                success: false, 
                error: "Author data missing in response",
                rawResponse: data 
              });
              return;
            }

            console.log(`[Scholarly BG] Author data found for DOI: ${doi}`);
            sendResponse({ success: true, correspondence, authorGroup });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message || String(err) });
          });
      });

      return true;
    }
  });
}

function parseScopusEntry(entry: any): any {
  const pickLatestMetric = (metric: any) => {
    if (!metric) return null;
    const values = Array.isArray(metric) ? metric : [metric];
    const normalized = values
      .map((v: any) => ({
        value: parseFloat(v?.["$"] ?? ""),
        year: parseInt(v?.["@year"] ?? "0", 10),
      }))
      .filter((v: any) => !isNaN(v.value) && !isNaN(v.year) && v.year > 0)
      .sort((a: any, b: any) => b.year - a.year);
    return normalized[0] || null;
  };

  const issns = [entry["prism:issn"], entry["prism:eIssn"]]
    .filter(Boolean)
    .map((i: string) => i.trim());

  const ranking: any = {
    title: entry["dc:title"] || "Unknown",
    issn: issns[0] || "",
    issns,
    publisher: entry["dc:publisher"] || "",
    coverageStartYear: entry["coverageStartYear"] || "",
    coverageEndYear: entry["coverageEndYear"] || "",
    aggregationType: entry["prism:aggregationType"] || "",
    openAccess: entry["openaccess"] || "0",
  };

  // Extract current SJR
  if (entry.SJRList?.SJR) {
    const latestSjr = pickLatestMetric(entry.SJRList.SJR);
    if (latestSjr) {
      ranking.sjr = latestSjr.value;
      ranking.sjrYear = latestSjr.year;
    }
  }

  // Extract current SNIP
  if (entry.SNIPList?.SNIP) {
    const latestSnip = pickLatestMetric(entry.SNIPList.SNIP);
    if (latestSnip) {
      ranking.snip = latestSnip.value;
      ranking.snipYear = latestSnip.year;
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
    ranking.subjectAreas = areas.map((area: any) => ({
      code: area["@code"],
      abbrev: area["@abbrev"],
      name: area["$"],
    }));
  }

  ranking.source = "scopus";
  return ranking;
}

/**
 * Normalizes an ISSN by removing hyphens and spaces.
 */
function normalizeIssn(issn: string): string {
  return issn.replace(/[-\s]/g, "").toUpperCase();
}

/**
 * Loads and indexes scimagojr_2024.json into a Map for fast lookup.
 */
async function loadLocalSjrData(): Promise<Map<string, LocalSjrData>> {
  if (localSjrMap) return localSjrMap;
  if (isLoadingLocalSjr) {
    // Wait for existing load to finish
    while (isLoadingLocalSjr) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return localSjrMap || new Map();
  }

  isLoadingLocalSjr = true;
  try {
    console.log("[Scholarly BG] Loading local SCImago JSON data...");
    const url = chrome.runtime.getURL("data/scimagojr_2024.json");
    const response = await fetch(url);
    const data = await response.json();

    const map = new Map<string, LocalSjrData>();
    for (const entry of data) {
      const sjrEntry: LocalSjrData = {
        rank: entry["Rank"],
        hIndex: entry["H index"],
        sjrBestQuartile: entry["SJR Best Quartile"],
        title: entry["Title"],
      };

      const issns = (entry["Issn"] || "").split(",").map((s: string) => s.trim());
      for (const issn of issns) {
        if (issn) {
          map.set(normalizeIssn(issn), sjrEntry);
        }
      }
    }

    localSjrMap = map;
    console.log(
      `[Scholarly BG] Indexed ${localSjrMap.size} ISSNs from local SJR data.`,
    );
    return localSjrMap;
  } catch (err) {
    console.error("[Scholarly BG] Failed to load local SJR data:", err);
    return new Map();
  } finally {
    isLoadingLocalSjr = false;
  }
}

/**
 * Looks up ranking data in the local SCImago dataset using ISSNs.
 */
async function augmentWithLocalSjr(ranking: any): Promise<any> {
  if (
    !ranking ||
    (!ranking.issn && (!ranking.issns || ranking.issns.length === 0))
  ) {
    return ranking;
  }

  const map = await loadLocalSjrData();
  const candidates = [ranking.issn, ...(ranking.issns || [])].filter(Boolean);

  for (const issn of candidates) {
    const normalized = normalizeIssn(issn);
    const localData = map.get(normalized);
    if (localData) {
      console.log(
        `[Scholarly BG] Local SJR match found for ISSN ${issn}: ${localData.title}`,
      );
      ranking.sjrBestQuartile = localData.sjrBestQuartile;
      ranking.hIndex = localData.hIndex;
      ranking.localRank = localData.rank;
      break;
    }
  }

  return ranking;
}

export {};
