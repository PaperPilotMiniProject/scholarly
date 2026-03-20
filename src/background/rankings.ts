/// <reference types="chrome" />

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
                const ranking = parseScopusEntry(entry);
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

        const params = new URLSearchParams({
          apikey: apiKey,
          view: "STANDARD",
        });
        if (instToken) {
          params.append("insttoken", instToken);
        }

        const url = `https://api.elsevier.com/content/serial/title/doi/${encodeURIComponent(doi)}?${params.toString()}`;
        console.log(`[Scholarly BG] Scopus request URL DOI: ${doi}`);

        fetch(url, {
          headers: {
            Accept: "application/json",
          },
        })
          .then((r) => r.json())
          .then((data) => {
            const entry = data["serial-metadata-response"]?.entry?.[0];
            if (!entry) {
              const serviceError =
                data["service-error"]?.status?.statusText ||
                data["service-error"]?.statusText ||
                data["service-error"]?.message ||
                "DOI not found in Scopus";
              sendResponse({ success: false, error: serviceError });
              return;
            }

            const ranking = parseScopusEntry(entry);
            ranking.doi = doi;
            console.log(
              `[Scholarly BG] Scopus DOI ranking found: ${ranking.title} | ISSN: ${(ranking.issns || []).join(", ")}`,
            );
            sendResponse({ success: true, ranking });
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

export {};
