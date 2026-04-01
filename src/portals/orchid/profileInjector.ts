/**
 * profileInjector.ts — ORCID DOM badge + stats injector
 *
 * Responsible for all DOM manipulation on orcid.org profile pages.
 * Takes enriched OrcidArticle objects from scraper.ts and:
 *   1. Injects SJR / SNIP / CiteScore / CitedBy badges next to each work title
 *   2. Renders a stats panel at the top of the works section showing
 *      publication trends, top journals, and average metrics
 *
 * Intentionally kept separate from scraper.ts so data fetching
 * and DOM manipulation are never mixed.
 */

import type { OrcidArticle, SemanticScholarData } from "./scraper";

// ─── Constants ────────────────────────────────────────────────────────────────

const BADGE_CLASS = "scholarly-badge";
const BADGE_ANCHOR_CLASS = "scholarly-badge-anchor";
const STATS_PANEL_ID = "scholarly-orcid-stats";

let injectionInterval: number | null = null;

// ─── Clear ────────────────────────────────────────────────────────────────────

/**
 * Removes all badges and the stats panel injected by Scholarly.
 * Called when the extension is toggled off or before a fresh scrape.
 */
export function clearOrcidBadges(): void {
  if (injectionInterval) {
    window.clearInterval(injectionInterval);
    injectionInterval = null;
  }
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  document
    .querySelectorAll(`.${BADGE_ANCHOR_CLASS}`)
    .forEach((el) => el.remove());
  document.getElementById(STATS_PANEL_ID)?.remove();
  console.log("[Scholarly][ORCID] Badges and stats panel cleared");
}

// ─── Badge Injection ──────────────────────────────────────────────────────────

/**
 * Finds the title element for a work by matching its DOI link in the DOM.
 * ORCID's app-work-stack has no put-code attribute accessible from JS.
 * Instead we find the anchor whose text matches the DOI, then walk up
 * to the work container and find the h4.work-title inside it.
 */
function findWorkTitleElement(doi: string | null, putCode: number): HTMLElement | null {
  if (doi) {
    // Find the link whose text content matches the DOI
    const allLinks = document.querySelectorAll('app-work-stack a.underline');
    for (const link of allLinks) {
      const text = link.textContent?.trim() ?? "";
      if (text === doi || text.includes(doi)) {
        // Walk up to the app-work-stack container
        const container = link.closest('app-work-stack');
        if (!container) continue;

        // Title is h4.work-title inside the container
        const titleEl = container.querySelector('h4.work-title');
        if (titleEl) return titleEl as HTMLElement;
      }
    }
  }

  // Fallback: no DOI match, can't locate this work in DOM
  // Removed warning here since it gets polled repeatedly
  return null;
}

/**
 * Creates or retrieves the badge anchor span after a title element.
 * All badges for a work are appended into this single container span,
 * keeping the DOM clean and easy to clear.
 */
function getOrCreateBadgeAnchor(titleEl: HTMLElement): HTMLElement {
  const existing = titleEl.querySelector(`.${BADGE_ANCHOR_CLASS}`);
  if (existing) return existing as HTMLElement;

  const anchor = document.createElement("span");
  anchor.className = BADGE_ANCHOR_CLASS;
  anchor.style.cssText =
    "display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:8px;vertical-align:middle;";

  // Append inside the h4 so it sits on the same line as the title text
  titleEl.appendChild(anchor);
  return anchor;
}

/**
 * Creates a single styled badge span.
 */
function createBadge(
  text: string,
  bgColor: string,
  title?: string,
): HTMLElement {
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.style.cssText = `
    display:inline-block;
    padding:2px 7px;
    background:${bgColor};
    color:#fff;
    font-size:11px;
    font-weight:bold;
    border-radius:3px;
    white-space:nowrap;
    cursor:default;
    font-family:system-ui,sans-serif;
  `;
  badge.textContent = text;
  if (title) badge.title = title; // tooltip on hover
  return badge;
}

// ─── Author Position Detection ───────────────────────────────────────────────────────────────────

/** Normalises a name: lowercase, strip punctuation, collapse whitespace. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.,\-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Returns true if ownerName likely matches contributorName (exact or last-name + initial). */
function nameMatches(ownerName: string, contributorName: string): boolean {
  const a = normalizeName(ownerName);
  const b = normalizeName(contributorName);
  if (a === b) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  if (aLast !== bLast) return false;
  if (aParts.length >= 2 && bParts.length >= 2) {
    return aParts[0][0] === bParts[0][0];
  }
  return true;
}

/** Returns the 0-based index of the owner in the contributor list, or null if not found. */
function findOwnerPosition(
  ownerName: string | null,
  contributors: { name: string; role: string | null; sequence: string | null }[],
): number | null {
  if (!ownerName || contributors.length === 0) return null;
  const idx = contributors.findIndex((c) => nameMatches(ownerName, c.name));
  return idx === -1 ? null : idx;
}

/** Returns badge label and colour for a given 0-based author position. */
function getPositionBadgeStyle(
  position: number,
  totalContributors: number,
): { label: string; color: string } {
  const isLast = totalContributors > 2 && position === totalContributors - 1;
  if (position === 0) return { label: "🥇 1st Author", color: "#c0392b" };
  if (position === 1) return { label: "🥈 2nd Author", color: "#2980b9" };
  if (isLast) return { label: "↩ Last Author", color: "#7d3c98" };
  const ord = (n: number): string => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? "th");
  };
  return { label: `${ord(position + 1)} Author`, color: "#546e7a" };
}

/**
 * Injects ranking badges for a single article into the ORCID work entry.
 * Returns true if badges were newly injected, false otherwise.
 */
function injectBadgesForArticle(article: OrcidArticle, ownerName: string | null): boolean {
  const { scopusRanking, putCode, doi, semanticScholar, citations, contributors } = article;

  const position = findOwnerPosition(ownerName, contributors);
  if (!scopusRanking && !semanticScholar && position === null) return false;

  // Pass doi as primary lookup, putCode for logging only
  const titleEl = findWorkTitleElement(doi, putCode);
  if (!titleEl) {
    return false;
  }

  // Check if badges are already present to avoid duplicate injections
  if (titleEl.querySelector(`.${BADGE_ANCHOR_CLASS}`)) {
    return false;
  }

  const anchor = getOrCreateBadgeAnchor(titleEl);

  // Author position badge — injected first for prominence
  if (position !== null) {
    const total = contributors.length;
    const { label, color } = getPositionBadgeStyle(position, total);
    anchor.appendChild(
      createBadge(label, color, `Position ${position + 1} of ${total} contributor${total !== 1 ? "s" : ""}`),
    );
  }

  if (scopusRanking) {
    // SJR badge — blue
    if (scopusRanking.sjr != null) {
      anchor.appendChild(
        createBadge(
          `SJR ${Number(scopusRanking.sjr).toFixed(3)} (${scopusRanking.sjrYear ?? "-"})`,
          "#1976d2",
          "SCImago Journal Rank — measures journal prestige based on citations",
        ),
      );
    }

    // SNIP badge — purple
    if (typeof scopusRanking.snip === "number") {
      anchor.appendChild(
        createBadge(
          `SNIP ${scopusRanking.snip.toFixed(3)} (${scopusRanking.snipYear ?? "-"})`,
          "#8e24aa",
          "Source Normalized Impact per Paper — field-normalized citation impact",
        ),
      );
    }

    // CiteScore badge — green
    if (scopusRanking.citeScore != null) {
      anchor.appendChild(
        createBadge(
          `CiteScore ${Number(scopusRanking.citeScore).toFixed(2)} (${scopusRanking.citeScoreYear ?? "-"})`,
          "#2e7d32",
          "CiteScore — average citations per document over 4 years",
        ),
      );
    }
  }

  // Semantic Scholar badges
  if (semanticScholar) {
    if (semanticScholar.citationCount > 0) {
      anchor.appendChild(
        createBadge(`📚 ${semanticScholar.citationCount} Citations`, "#3f51b5", "Semantic Scholar citation count"),
      );
    }
    if (semanticScholar.influentialCitationCount > 0) {
      anchor.appendChild(
        createBadge(`⭐ ${semanticScholar.influentialCitationCount} Influential`, "#f57c00", "Highly influential citations"),
      );
    }
    if (semanticScholar.referenceCount > 0) {
      anchor.appendChild(
        createBadge(`🔗 ${semanticScholar.referenceCount} Refs`, "#00695c", "Number of papers referenced by this work"),
      );
    }
    if (semanticScholar.isOpenAccess) {
      anchor.appendChild(
        createBadge(`🔓 Open Access`, "#4caf50", "Paper is freely available"),
      );
    }
  } else if (citations && citations > 0) {
    // Fallback to ORCID citations if S2 isn't available
    anchor.appendChild(
      createBadge(`Cited by ${citations}`, "#e65100", "Citation count from ORCID"),
    );
  }

  return true;
}

// ─── Stats Panel ──────────────────────────────────────────────────────────────

interface StatsData {
  totalWorks: number;
  worksWithRanking: number;
  avgSjr: number | null;
  avgSnip: number | null;
  avgCiteScore: number | null;
  publicationsByYear: Record<string, number>;
  topJournals: Array<{ name: string; count: number; avgSjr: number | null }>;
  authorPositions: { first: number; second: number; last: number; other: number };
}

/**
 * Computes aggregate stats from the enriched article list.
 */
function computeStats(articles: OrcidArticle[], ownerName: string | null): StatsData {
  const ranked = articles.filter((a) => a.scopusRanking !== null);

  // Average metrics
  const sjrValues = ranked
    .map((a) => Number(a.scopusRanking?.sjr))
    .filter((v) => !isNaN(v) && v > 0);
  const snipValues = ranked
    .map((a) => a.scopusRanking?.snip)
    .filter((v): v is number => typeof v === "number");
  const csValues = ranked
    .map((a) => Number(a.scopusRanking?.citeScore))
    .filter((v) => !isNaN(v) && v > 0);

  const avg = (arr: number[]): number | null =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  // Publications by year
  const byYear: Record<string, number> = {};
  articles.forEach((a) => {
    if (a.year) {
      byYear[a.year] = (byYear[a.year] ?? 0) + 1;
    }
  });

  // Top journals by frequency, with average SJR
  const journalMap: Record<
    string,
    { count: number; sjrSum: number; sjrCount: number }
  > = {};

  articles.forEach((a) => {
    const journal = a.journalTitle?.trim();
    if (!journal) return;

    if (!journalMap[journal]) {
      journalMap[journal] = { count: 0, sjrSum: 0, sjrCount: 0 };
    }

    journalMap[journal].count += 1;

    const sjr = Number(a.scopusRanking?.sjr);
    if (!isNaN(sjr) && sjr > 0) {
      journalMap[journal].sjrSum += sjr;
      journalMap[journal].sjrCount += 1;
    }
  });

  const topJournals = Object.entries(journalMap)
    .map(([name, data]) => ({
      name,
      count: data.count,
      avgSjr: data.sjrCount > 0 ? data.sjrSum / data.sjrCount : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Author position breakdown
  const authorPositions = { first: 0, second: 0, last: 0, other: 0 };
  if (ownerName) {
    articles.forEach((a) => {
      const pos = findOwnerPosition(ownerName, a.contributors);
      if (pos === null) return;
      if (pos === 0) { authorPositions.first += 1; return; }
      if (pos === 1) { authorPositions.second += 1; return; }
      if (a.contributors.length > 2 && pos === a.contributors.length - 1) {
        authorPositions.last += 1; return;
      }
      authorPositions.other += 1;
    });
  }

  return {
    totalWorks: articles.length,
    worksWithRanking: ranked.length,
    avgSjr: avg(sjrValues),
    avgSnip: avg(snipValues),
    avgCiteScore: avg(csValues),
    publicationsByYear: byYear,
    topJournals,
    authorPositions,
  };
}

/**
 * Builds the mini bar chart SVG for publications per year.
 */
function buildYearChart(byYear: Record<string, number>): string {
  const entries = Object.entries(byYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(-12); // last 12 years max

  if (entries.length === 0) return "";

  const maxCount = Math.max(...entries.map(([, v]) => v));
  const barWidth = 20;
  const gap = 6;
  const chartHeight = 60;
  const totalWidth = entries.length * (barWidth + gap);

  const bars = entries
    .map(([year, count], i) => {
      const barH = maxCount > 0 ? (count / maxCount) * chartHeight : 0;
      const x = i * (barWidth + gap);
      const y = chartHeight - barH;

      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}"
            fill="#1976d2" rx="2" opacity="0.85"/>
          <text x="${x + barWidth / 2}" y="${chartHeight + 12}"
            text-anchor="middle" font-size="8" fill="#666"
            font-family="system-ui,sans-serif">
            ${year.slice(2)}
          </text>
          <text x="${x + barWidth / 2}" y="${y - 3}"
            text-anchor="middle" font-size="8" fill="#333"
            font-family="system-ui,sans-serif">
            ${count}
          </text>
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${totalWidth} ${chartHeight + 20}"
      width="${totalWidth}" height="${chartHeight + 20}"
      style="overflow:visible">
      ${bars}
    </svg>
  `;
}

/**
 * Renders and injects the stats panel above the works section.
 */
function injectStatsPanel(stats: StatsData): void {
  // Don't inject if no useful data
  if (stats.totalWorks === 0) return;

  // Find the works section to inject before
  const worksSection =
    document.querySelector("#orcid-works") ??
    document.querySelector("orcid-works") ??
    document.querySelector("[id*='works']");

  if (!worksSection) {
    console.warn(
      "[Scholarly][ORCID] Could not find works section for stats panel",
    );
    return;
  }

  // Remove existing panel if any
  document.getElementById(STATS_PANEL_ID)?.remove();

  const panel = document.createElement("div");
  panel.id = STATS_PANEL_ID;
  panel.style.cssText = `
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 16px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    color: #333;
  `;

  // Metric pill helper
  const pill = (label: string, value: string, color: string): string => `
    <div style="
      display:inline-flex;flex-direction:column;align-items:center;
      background:${color};color:#fff;border-radius:6px;
      padding:6px 14px;margin-right:8px;min-width:80px;
    ">
      <span style="font-size:16px;font-weight:bold;">${value}</span>
      <span style="font-size:10px;opacity:0.9;margin-top:2px;">${label}</span>
    </div>
  `;

  // Top journals rows
  const journalRows = stats.topJournals
    .map(
      (j) => `
      <tr>
        <td style="padding:3px 8px 3px 0;max-width:240px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap;" title="${j.name}">
          ${j.name}
        </td>
        <td style="padding:3px 8px;text-align:center;color:#555;">
          ${j.count}
        </td>
        <td style="padding:3px 0;text-align:center;color:#1976d2;font-weight:bold;">
          ${j.avgSjr != null ? j.avgSjr.toFixed(3) : "—"}
        </td>
      </tr>
    `,
    )
    .join("");

  const yearChart = buildYearChart(stats.publicationsByYear);

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <div style="font-weight:600;font-size:14px;color:#111;">
        📊 Scholarly Metrics
        <span style="font-weight:normal;font-size:11px;color:#888;margin-left:6px;">
          ${stats.worksWithRanking} of ${stats.totalWorks} works matched in Scopus
        </span>
      </div>
    </div>

    <!-- Metric pills -->
    <div style="margin-bottom:14px;">
      ${pill("Avg SJR", stats.avgSjr != null ? stats.avgSjr.toFixed(3) : "—", "#1976d2")}
      ${pill("Avg SNIP", stats.avgSnip != null ? stats.avgSnip.toFixed(3) : "—", "#8e24aa")}
      ${pill("Avg CiteScore", stats.avgCiteScore != null ? stats.avgCiteScore.toFixed(2) : "—", "#2e7d32")}
      ${pill("Total Works", String(stats.totalWorks), "#455a64")}
    </div>

    <!-- Author position breakdown -->
    ${(stats.authorPositions.first + stats.authorPositions.second + stats.authorPositions.last + stats.authorPositions.other) > 0 ? `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:600;letter-spacing:0.5px;">AUTHOR POSITIONS</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${stats.authorPositions.first > 0 ? pill("1st Author", String(stats.authorPositions.first), "#c0392b") : ""}
        ${stats.authorPositions.second > 0 ? pill("2nd Author", String(stats.authorPositions.second), "#2980b9") : ""}
        ${stats.authorPositions.last > 0 ? pill("Last Author", String(stats.authorPositions.last), "#7d3c98") : ""}
        ${stats.authorPositions.other > 0 ? pill("Other", String(stats.authorPositions.other), "#546e7a") : ""}
      </div>
    </div>
    ` : ""}

    <div style="display:flex;gap:24px;flex-wrap:wrap;">
      <!-- Publications per year chart -->
      ${
        yearChart
          ? `
        <div>
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:600;">
            PUBLICATIONS PER YEAR
          </div>
          ${yearChart}
        </div>
      `
          : ""
      }

      <!-- Top journals table -->
      ${
        stats.topJournals.length > 0
          ? `
        <div>
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:600;">
            TOP JOURNALS
          </div>
          <table style="border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="color:#888;font-size:10px;text-transform:uppercase;">
                <th style="padding:2px 8px 6px 0;text-align:left;font-weight:600;">Journal</th>
                <th style="padding:2px 8px 6px;text-align:center;font-weight:600;">Papers</th>
                <th style="padding:2px 0 6px;text-align:center;font-weight:600;">Avg SJR</th>
              </tr>
            </thead>
            <tbody>${journalRows}</tbody>
          </table>
        </div>
      `
          : ""
      }
    </div>

    <div style="margin-top:10px;font-size:10px;color:#aaa;">
      Powered by Scholarly · Scopus & Semantic Scholar APIs
    </div>
  `;

  worksSection.insertAdjacentElement("beforebegin", panel);
  console.log("[Scholarly][ORCID] Stats panel injected");
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Main entry point called by scraper.ts after data is ready.
 * Injects badges for each article and renders the stats panel.
 */
export const injectOrcidBadges = (articles: OrcidArticle[], ownerName: string | null): void => {
  console.log(
    `[Scholarly][ORCID] Beginning continuous badge injection for ${articles.length} articles...`,
  );

  // Compute and inject the stats panel (only once)
  const stats = computeStats(articles, ownerName);
  injectStatsPanel(stats);

  if (injectionInterval) {
    window.clearInterval(injectionInterval);
  }

  const attemptInjection = () => {
    let injectedThisRound = 0;
    articles.forEach((article) => {
      if (article.scopusRanking || article.semanticScholar || ownerName) {
        if (injectBadgesForArticle(article, ownerName)) {
          injectedThisRound += 1;
        }
      }
    });

    if (injectedThisRound > 0) {
      console.log(`[Scholarly][ORCID] Injected badges for ${injectedThisRound} articles this round`);
    }
  };

  attemptInjection();
  injectionInterval = window.setInterval(attemptInjection, 2000);
}