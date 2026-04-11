/**
 * profileInjector.ts — ORCID DOM badge + stats injector
 *
 * Responsible for all DOM manipulation on orcid.org profile pages.
 * Takes enriched OrcidArticle objects from scraper.ts and:
 *   1. Injects interactive bubbles / static pills next to each work title
 *      that match the Google Scholar profile page design.
 *   2. Renders a stats panel at the top of the works section showing
 *      publication trends, top journals, and average metrics.
 *
 * Design parity: mirrors the scholarly-interactive-bubble / scholarly-static-pill
 * / scholarly-q-tag / scholarly-pos-circle system used in googlescholarprofile.ts.
 */

import type { OrcidArticle } from "./scraper";

// ─── Constants ────────────────────────────────────────────────────────────────

const BADGE_CLASS = "scholarly-badge";
const BADGE_ANCHOR_CLASS = "scholarly-badge-anchor";
const STATS_PANEL_ID = "scholarly-orcid-stats";
const ORCID_STYLES_ID = "scholarly-orcid-styles";

let injectionInterval: number | null = null;

// ─── Stylesheet injection ─────────────────────────────────────────────────────

/**
 * Injects the shared Scholarly CSS into the ORCID page once.
 * Mirrors the same classes used by googlescholarprofile.ts so the visual
 * language is identical across both portals.
 */
function injectOrcidStyles(): void {
  document.getElementById(ORCID_STYLES_ID)?.remove();
  const style = document.createElement("style");
  style.id = ORCID_STYLES_ID;
  style.textContent = `
    /* ── Badge anchor ───────────────────────────────────────────── */
    .${BADGE_ANCHOR_CLASS} {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      margin-left: 10px !important;
      vertical-align: middle !important;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      position: relative !important;
      flex-wrap: wrap !important;
    }
    .${BADGE_ANCHOR_CLASS}:has(.scholarly-interactive-bubble:hover) {
      z-index: 99999 !important;
    }

    /* ── Interactive bubble (circle with hover popover) ─────────── */
    .scholarly-interactive-bubble {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: #ffffff !important;
      border: 1px solid #e1e4e8 !important;
      border-radius: 50% !important;
      width: 24px !important;
      height: 24px !important;
      cursor: help !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
      flex-shrink: 0 !important;
    }
    .scholarly-interactive-bubble:hover {
      border-color: #1a73e8 !important;
      box-shadow: 0 4px 12px rgba(26, 115, 232, 0.15) !important;
      transform: translateY(-1px) !important;
      z-index: 99999 !important;
    }
    .scholarly-badge-circle {
      width: 100% !important;
      height: 100% !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 10px !important;
      font-weight: 800 !important;
    }

    /* ── Static pill ────────────────────────────────────────────── */
    .scholarly-static-pill {
      display: inline-flex !important;
      align-items: center !important;
      height: 22px !important;
      padding: 0 8px !important;
      background: #ffffff !important;
      border: 1px solid #e1e4e8 !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      color: #202124 !important;
      white-space: nowrap !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
    }

    /* ── Quartile tag ───────────────────────────────────────────── */
    .scholarly-q-tag {
      font-size: 10px !important;
      font-weight: 800 !important;
      padding: 2px 8px !important;
      border-radius: 6px !important;
      text-transform: uppercase !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
      height: 22px !important;
      display: inline-flex !important;
      align-items: center !important;
    }

    /* ── Author-position circle ─────────────────────────────────── */
    .scholarly-pos-circle {
      width: 24px !important;
      height: 24px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 9px !important;
      font-weight: 800 !important;
      color: #fff !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
      flex-shrink: 0 !important;
    }

    /* ── Hover popover card ─────────────────────────────────────── */
    .scholarly-bubble-popover {
      position: absolute !important;
      top: 32px !important;
      left: 50% !important;
      transform: translateX(-50%) translateY(-10px) !important;
      background-color: #ffffff !important;
      border: 1px solid #bbb !important;
      border-radius: 12px !important;
      padding: 16px !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
      z-index: 99999 !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease !important;
      min-width: 260px !important;
      max-width: 420px !important;
      pointer-events: none !important;
      isolation: isolate !important;
    }
    .scholarly-interactive-bubble:hover > .scholarly-bubble-popover {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateX(-50%) translateY(0) !important;
      pointer-events: auto !important;
    }
    .scholarly-bubble-popover::before {
      content: '' !important;
      position: absolute !important;
      top: -6px !important;
      left: 50% !important;
      transform: translateX(-50%) rotate(45deg) !important;
      width: 10px !important;
      height: 10px !important;
      background: #ffffff !important;
      border-top: 1px solid #bbb !important;
      border-left: 1px solid #bbb !important;
      z-index: 1 !important;
    }
    .scholarly-popover-row {
      display: flex !important;
      justify-content: space-between !important;
      gap: 12px !important;
      margin-bottom: 8px !important;
      background: transparent !important;
    }
    .scholarly-popover-row:last-child {
      margin-bottom: 0 !important;
    }

    /* ── Stats panel ────────────────────────────────────────────── */
    #${STATS_PANEL_ID} {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, system-ui, sans-serif;
      font-size: 13px;
      color: #333;
    }
  `;
  document.head.appendChild(style);
}

// ─── Clear ────────────────────────────────────────────────────────────────────

/**
 * Removes all badges and the stats panel injected by Scholarly.
 */
export function clearOrcidBadges(): void {
  if (injectionInterval) {
    window.clearInterval(injectionInterval);
    injectionInterval = null;
  }
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`.${BADGE_ANCHOR_CLASS}`).forEach((el) => el.remove());
  document.getElementById(STATS_PANEL_ID)?.remove();
  document.getElementById(ORCID_STYLES_ID)?.remove();
  console.log("[Scholarly][ORCID] Badges and stats panel cleared");
}

// ─── DOM lookup helpers ───────────────────────────────────────────────────────

/**
 * Finds the title element for a work by matching its DOI link in the DOM.
 */
function findWorkTitleElement(doi: string | null, putCode: number): HTMLElement | null {
  if (doi) {
    const allLinks = document.querySelectorAll("app-work-stack a.underline");
    for (const link of allLinks) {
      const text = link.textContent?.trim() ?? "";
      if (text === doi || text.includes(doi)) {
        const container = link.closest("app-work-stack");
        if (!container) continue;
        const titleEl = container.querySelector("h4.work-title");
        if (titleEl) return titleEl as HTMLElement;
      }
    }
  }
  return null;
}

/**
 * Creates or retrieves the badge anchor span after a title element.
 */
function getOrCreateBadgeAnchor(titleEl: HTMLElement): HTMLElement {
  const existing = titleEl.querySelector(`.${BADGE_ANCHOR_CLASS}`);
  if (existing) return existing as HTMLElement;

  const anchor = document.createElement("span");
  anchor.className = BADGE_ANCHOR_CLASS;
  titleEl.appendChild(anchor);
  return anchor;
}

// ─── Component builders ───────────────────────────────────────────────────────

/**
 * Builds an interactive bubble (circle) with a hover popover card.
 * Matches the "JR" / "CA" bubbles on Google Scholar.
 */
function createInteractiveBubble(opts: {
  label: string;
  bgColor: string;
  textColor: string;
  borderStyle?: string;
  popoverTitle: string;
  popoverTitleColor?: string;
  rows: Array<[string, string]>;
  footer?: string;
}): HTMLElement {
  const bubble = document.createElement("div");
  bubble.className = `scholarly-interactive-bubble ${BADGE_CLASS}`;

  const rowsHtml = opts.rows
    .map(
      ([l, v]) => `
      <div class="scholarly-popover-row">
        <span style="font-weight:600; color:#5f6368; font-size:12px;">${l}</span>
        <span style="color:#202124; font-size:12px; text-align:right;">${v}</span>
      </div>`,
    )
    .join("");

  bubble.innerHTML = `
    <div class="scholarly-badge-circle" style="background:${opts.bgColor}; color:${opts.textColor}; ${opts.borderStyle ? `border:${opts.borderStyle};` : ""}">
      ${opts.label}
    </div>
    <div class="scholarly-bubble-popover">
      <div style="font-size:13px; font-weight:700; color:${opts.popoverTitleColor ?? "#202124"}; margin-bottom:12px; border-bottom:1px solid #e8eaed; padding-bottom:8px;">
        ${opts.popoverTitle}
      </div>
      ${rowsHtml}
      ${opts.footer ? `<div style="margin-top:10px; padding-top:8px; border-top:1px solid #e8eaed; font-size:10px; color:#70757a; text-align:center;">${opts.footer}</div>` : ""}
    </div>
  `;
  return bubble;
}

/**
 * Builds a static pill (rounded rectangle label).
 * Matches the SJR pill on Google Scholar.
 */
function createStaticPill(text: string, color?: string): HTMLElement {
  const pill = document.createElement("span");
  pill.className = `scholarly-static-pill ${BADGE_CLASS}`;
  if (color) pill.style.color = color;
  pill.textContent = text;
  return pill;
}

/**
 * Builds a quartile tag.
 * Matches the Q1/Q2/Q3/Q4 tags on Google Scholar.
 */
function createQuartileTag(q: string): HTMLElement {
  let bg = "#f1f3f4", col = "#5f6368";
  if (q === "Q1") { bg = "#e6f4ea"; col = "#137333"; }
  else if (q === "Q2") { bg = "#fef7e0"; col = "#b06000"; }
  else if (q === "Q3") { bg = "#feefe3"; col = "#b06000"; }
  else if (q === "Q4") { bg = "#fce8e6"; col = "#a50e0e"; }

  const tag = document.createElement("span");
  tag.className = `scholarly-q-tag ${BADGE_CLASS}`;
  tag.style.background = bg;
  tag.style.color = col;
  tag.textContent = q;
  return tag;
}

/**
 * Builds an author-position circle.
 * Matches the pos-circle on Google Scholar.
 */
function createPositionCircle(label: string, shortText: string, color: string): HTMLElement {
  const circle = document.createElement("span");
  circle.className = `scholarly-pos-circle ${BADGE_CLASS}`;
  circle.style.background = color;
  circle.title = label;
  circle.textContent = shortText;
  return circle;
}

// ─── Author Position Detection ────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.,\-]/g, " ").replace(/\s+/g, " ").trim();
}

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

function findOwnerPosition(
  ownerName: string | null,
  contributors: { name: string; role: string | null; sequence: string | null }[],
): number | null {
  if (!ownerName || contributors.length === 0) return null;
  const idx = contributors.findIndex((c) => nameMatches(ownerName, c.name));
  return idx === -1 ? null : idx;
}

function getPositionStyle(
  position: number,
  totalContributors: number,
): { label: string; shortText: string; color: string } {
  const isLast = totalContributors > 2 && position === totalContributors - 1;
  if (position === 0) return { label: "1st Author", shortText: "1st", color: "#c0392b" };
  if (position === 1) return { label: "2nd Author", shortText: "2nd", color: "#2980b9" };
  if (isLast) return { label: "Last Author", shortText: "↩", color: "#7d3c98" };
  const ord = (n: number): string => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? "th");
  };
  return {
    label: `${ord(position + 1)} Author`,
    shortText: `${position + 1}th`,
    color: "#546e7a",
  };
}

// ─── Per-article badge injection ──────────────────────────────────────────────

function injectBadgesForArticle(article: OrcidArticle, ownerName: string | null): boolean {
  const { scopusRanking, putCode, doi, semanticScholar, citations, contributors } = article;

  const position = findOwnerPosition(ownerName, contributors);
  if (!scopusRanking && !semanticScholar && position === null) return false;

  const titleEl = findWorkTitleElement(doi, putCode);
  if (!titleEl) return false;

  // Bail out if badges already present
  if (titleEl.querySelector(`.${BADGE_ANCHOR_CLASS}`)) return false;

  const anchor = getOrCreateBadgeAnchor(titleEl);

  // ── 1. Author position circle ────────────────────────────────────────────
  if (position !== null) {
    const total = contributors.length;
    const { label, shortText, color } = getPositionStyle(position, total);
    anchor.appendChild(createPositionCircle(label, shortText, color));
  }

  // ── 2. Journal ranking — interactive JR bubble ───────────────────────────
  if (scopusRanking) {
    const sjr = Number(scopusRanking.sjr ?? 0);
    const snip = typeof scopusRanking.snip === "number" ? scopusRanking.snip : null;
    const citeScore = Number(scopusRanking.citeScore ?? 0);
    const q = (scopusRanking as any).sjrBestQuartile as string | undefined;

    const rows: Array<[string, string]> = [
      ["SJR", sjr > 0 ? `${sjr.toFixed(3)}${q ? ` (${q})` : ""}` : "—"],
      ["SNIP", snip != null ? snip.toFixed(3) : "—"],
      ["CiteScore", citeScore > 0 ? citeScore.toFixed(2) : "—"],
    ];

    anchor.appendChild(
      createInteractiveBubble({
        label: "JR",
        bgColor: "#f1f3f4",
        textColor: "#5f6368",
        popoverTitle: "Journal Ranking Details",
        popoverTitleColor: "#1a73e8",
        rows,
        footer: "Powered by Scopus",
      }),
    );

    // SJR static pill
    if (sjr > 0) {
      let sjrColor = "#202124";
      if (sjr > 4) sjrColor = "#1a73e8";
      else if (sjr > 1) sjrColor = "#188038";
      anchor.appendChild(createStaticPill(`SJR ${sjr.toFixed(3)}`, sjrColor));
    }

    // Quartile tag
    if (q) anchor.appendChild(createQuartileTag(q));
  }

  // ── 3. Semantic Scholar — interactive "S2" bubble ────────────────────────
  if (semanticScholar) {
    const rows: Array<[string, string]> = [
      ["Citations", String(semanticScholar.citationCount)],
      ["Influential", String(semanticScholar.influentialCitationCount)],
      ["References", String(semanticScholar.referenceCount)],
      ["Open Access", semanticScholar.isOpenAccess ? "Yes 🔓" : "No"],
    ];

    anchor.appendChild(
      createInteractiveBubble({
        label: "S2",
        bgColor: "#f1f3f4",
        textColor: "#3f51b5",
        popoverTitle: "Semantic Scholar Metrics",
        popoverTitleColor: "#3f51b5",
        rows,
        footer: "Powered by Semantic Scholar",
      }),
    );

    // Citation count static pill
    if (semanticScholar.citationCount > 0) {
      anchor.appendChild(
        createStaticPill(`📚 ${semanticScholar.citationCount} citations`, "#202124"),
      );
    }
  } else if (citations && citations > 0) {
    // Fallback citation pill from ORCID data
    anchor.appendChild(createStaticPill(`Cited by ${citations}`, "#202124"));
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

function computeStats(articles: OrcidArticle[], ownerName: string | null): StatsData {
  const ranked = articles.filter((a) => a.scopusRanking !== null);

  const sjrValues = ranked
    .map((a) => Number(a.scopusRanking?.sjr))
    .filter((v) => !isNaN(v) && v > 0);
  const snipValues = ranked
    .map((a) => a.scopusRanking?.snip)
  const csValues = ranked
    .map((a) => Number(a.scopusRanking?.citeScore))
    .filter((v) => !isNaN(v) && v > 0);

  const avg = (arr: number[]): number | null =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const byYear: Record<string, number> = {};
  articles.forEach((a) => {
    if (a.year) byYear[a.year] = (byYear[a.year] ?? 0) + 1;
  });

  const journalMap: Record<string, { count: number; sjrSum: number; sjrCount: number }> = {};
  articles.forEach((a) => {
    const journal = a.journalTitle?.trim();
    if (!journal) return;
    if (!journalMap[journal]) journalMap[journal] = { count: 0, sjrSum: 0, sjrCount: 0 };
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
 * Builds the mini bar-chart SVG for publications per year.
 * Taller bars, axis baseline, rounded tops.
 */
function buildYearChart(byYear: Record<string, number>): string {
  const entries = Object.entries(byYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .slice(-12);

  if (entries.length === 0) return "";

  const maxCount = Math.max(...entries.map(([, v]) => v));
  const barWidth = 22;
  const gap = 7;
  const chartHeight = 72;
  const totalWidth = entries.length * (barWidth + gap);

  const bars = entries
    .map(([year, count], i) => {
      const barH = maxCount > 0 ? Math.max(4, (count / maxCount) * chartHeight) : 4;
      const x = i * (barWidth + gap);
      const y = chartHeight - barH;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}"
            fill="#1a73e8" rx="3"/>
          <text x="${x + barWidth / 2}" y="${chartHeight + 13}"
            text-anchor="middle" font-size="9" fill="#5f6368"
            font-family="'Segoe UI',system-ui,sans-serif">${year.slice(2)}</text>
          <text x="${x + barWidth / 2}" y="${y - 4}"
            text-anchor="middle" font-size="9" fill="#202124" font-weight="600"
            font-family="'Segoe UI',system-ui,sans-serif">${count}</text>
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${totalWidth} ${chartHeight + 22}"
      width="${totalWidth}" height="${chartHeight + 22}"
      style="overflow:visible;display:block;">
      <line x1="0" y1="${chartHeight}" x2="${totalWidth}" y2="${chartHeight}"
        stroke="#e8eaed" stroke-width="1"/>
      ${bars}
    </svg>
  `;
}

/**
 * Renders the Scholarly Metrics panel above the works section.
 * Modern card layout: stat cards with colored left-border accents,
 * author-position pills matching the GS profile panel, a white-card
 * bar chart, and a clean ranked journal table.
 */
function injectStatsPanel(stats: StatsData): void {
  if (stats.totalWorks === 0) return;

  const worksSection =
    document.querySelector("#orcid-works") ??
    document.querySelector("orcid-works") ??
    document.querySelector("[id*='works']");

  if (!worksSection) {
    console.warn("[Scholarly][ORCID] Could not find works section for stats panel");
    return;
  }

  document.getElementById(STATS_PANEL_ID)?.remove();

  // ── Stat card with colored left-border accent ─────────────────────────────
  const statCard = (icon: string, label: string, value: string, accentColor: string): string => `
    <div style="
      display:flex;align-items:center;gap:10px;
      background:#fff;border:1px solid #e8eaed;border-radius:8px;
      border-left:4px solid ${accentColor};
      padding:10px 14px;min-width:110px;flex:1;
      box-shadow:0 1px 3px rgba(0,0,0,0.06);
    ">
      <span style="font-size:20px;line-height:1;">${icon}</span>
      <div style="display:flex;flex-direction:column;">
        <span style="font-size:17px;font-weight:800;color:#202124;line-height:1.2;">${value}</span>
        <span style="font-size:10px;color:#5f6368;margin-top:2px;font-weight:500;">${label}</span>
      </div>
    </div>
  `;

  // ── Author position pill (matches GS position panel exactly) ─────────────
  const posPill = (label: string, value: string, bg: string): string => `
    <div style="
      display:inline-flex;flex-direction:column;align-items:center;
      background:${bg};color:#fff;border-radius:6px;
      padding:6px 14px;min-width:64px;
      box-shadow:0 1px 3px rgba(0,0,0,0.15);
    ">
      <span style="font-size:16px;font-weight:bold;">${value}</span>
      <span style="font-size:10px;opacity:0.9;margin-top:2px;">${label}</span>
    </div>
  `;

  // ── Journal table rows ────────────────────────────────────────────────────
  const journalRows = stats.topJournals
    .map((j, idx) => {
      let sjrColor = "#555";
      if (j.avgSjr !== null) {
        if (j.avgSjr > 4) sjrColor = "#1a73e8";
        else if (j.avgSjr > 1) sjrColor = "#188038";
      }
      const rankBg = idx === 0 ? "#fef7e0" : "#f8f9fa";
      const rankCol = idx === 0 ? "#b06000" : "#5f6368";
      return `
        <tr style="border-bottom:1px solid #f1f3f4;">
          <td style="padding:7px 8px 7px 10px;vertical-align:middle;display:flex;align-items:center;gap:6px;">
            <span style="
              display:inline-flex;align-items:center;justify-content:center;
              width:18px;height:18px;border-radius:4px;flex-shrink:0;
              background:${rankBg};color:${rankCol};font-size:10px;font-weight:800;
            ">${idx + 1}</span>
            <span style="font-size:12px;color:#202124;
              max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              title="${j.name}">${j.name}</span>
          </td>
          <td style="padding:7px 10px;text-align:center;font-size:12px;color:#5f6368;font-weight:600;">${j.count}</td>
          <td style="padding:7px 10px 7px 0;text-align:right;font-size:12px;font-weight:700;color:${sjrColor};">
            ${j.avgSjr != null ? j.avgSjr.toFixed(3) : "—"}
          </td>
        </tr>
      `;
    })
    .join("");

  const yearChart = buildYearChart(stats.publicationsByYear);

  const posTotal =
    stats.authorPositions.first +
    stats.authorPositions.second +
    stats.authorPositions.last +
    stats.authorPositions.other;

  const posPillHtml =
    posTotal > 0
      ? `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;color:#5f6368;margin-bottom:8px;font-weight:700;
          letter-spacing:0.6px;text-transform:uppercase;">Author Positions</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${stats.authorPositions.first > 0 ? posPill("1st Author", String(stats.authorPositions.first), "#c0392b") : ""}
          ${stats.authorPositions.second > 0 ? posPill("2nd Author", String(stats.authorPositions.second), "#2980b9") : ""}
          ${stats.authorPositions.last > 0 ? posPill("Last Author", String(stats.authorPositions.last), "#7d3c98") : ""}
          ${stats.authorPositions.other > 0 ? posPill("Other", String(stats.authorPositions.other), "#546e7a") : ""}
        </div>
      </div>`
      : "";

  const panel = document.createElement("div");
  panel.id = STATS_PANEL_ID;
  panel.style.cssText = `
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    padding: 18px 20px;
    margin-bottom: 16px;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, system-ui, sans-serif;
    font-size: 13px;
    color: #202124;
  `;

  panel.innerHTML = `
    <!-- ── Header ──────────────────────────────────────────────── -->
    <div style="display:flex;align-items:center;justify-content:space-between;
      margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #e8eaed;
      flex-wrap:wrap;gap:6px;">
      <div style="font-weight:700;font-size:14px;color:#202124;
        display:flex;align-items:center;gap:6px;">
        <span style="font-size:18px;">📊</span>
        Scholarly Metrics
      </div>
      <span style="font-size:11px;color:#5f6368;background:#fff;
        border:1px solid #e0e0e0;border-radius:12px;
        padding:2px 10px;font-weight:500;">
        ${stats.worksWithRanking} / ${stats.totalWorks} matched in Scopus
      </span>
    </div>

    <!-- ── Average metric stat cards ─────────────────────────── -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${statCard("📈", "Avg SJR", stats.avgSjr != null ? stats.avgSjr.toFixed(3) : "—", "#1976d2")}
      ${statCard("📉", "Avg SNIP", stats.avgSnip != null ? stats.avgSnip.toFixed(3) : "—", "#8e24aa")}
      ${statCard("⭐", "Avg CiteScore", stats.avgCiteScore != null ? stats.avgCiteScore.toFixed(2) : "—", "#2e7d32")}
      ${statCard("📄", "Total Works", String(stats.totalWorks), "#455a64")}
    </div>

    <div style="border-top:1px solid #e8eaed;margin-bottom:14px;"></div>

    <!-- ── Author positions ───────────────────────────────────── -->
    ${posPillHtml}

    <!-- ── Chart + Journal table side by side ────────────────── -->
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start;">

      <!-- Publications per year chart -->
      ${yearChart ? `
        <div style="flex:0 0 auto;">
          <div style="font-size:11px;color:#5f6368;margin-bottom:8px;font-weight:700;
            letter-spacing:0.6px;text-transform:uppercase;">Publications per Year</div>
          <div style="background:#fff;border:1px solid #e8eaed;border-radius:8px;
            padding:12px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.04);overflow:visible;">
            ${yearChart}
          </div>
        </div>
      ` : ""}

      <!-- Top journals table -->
      ${stats.topJournals.length > 0 ? `
        <div style="flex:1;min-width:260px;">
          <div style="font-size:11px;color:#5f6368;margin-bottom:8px;font-weight:700;
            letter-spacing:0.6px;text-transform:uppercase;">Top Journals</div>
          <div style="background:#fff;border:1px solid #e8eaed;border-radius:8px;
            overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <table style="border-collapse:collapse;font-size:12px;width:100%;">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #e8eaed;">
                  <th style="padding:7px 8px 7px 10px;text-align:left;font-size:10px;
                    font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.4px;">Journal</th>
                  <th style="padding:7px 10px;text-align:center;font-size:10px;
                    font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.4px;">Papers</th>
                  <th style="padding:7px 10px 7px 0;text-align:right;font-size:10px;
                    font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:0.4px;">Avg SJR</th>
                </tr>
              </thead>
              <tbody>${journalRows}</tbody>
            </table>
          </div>
        </div>
      ` : ""}

    </div>

    <!-- ── Footer ─────────────────────────────────────────────── -->
    <div style="margin-top:12px;padding-top:8px;border-top:1px solid #f1f3f4;
      font-size:10px;color:#9aa0a6;display:flex;align-items:center;gap:4px;">
      <span>⚡</span>
      Powered by Scholarly · Scopus &amp; Semantic Scholar APIs
    </div>
  `;

  worksSection.insertAdjacentElement("beforebegin", panel);
  console.log("[Scholarly][ORCID] Stats panel injected");
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Main entry point called by scraper.ts after data is ready.
 * Injects styles, stats panel, and per-article badges.
 */
export const injectOrcidBadges = (articles: OrcidArticle[], ownerName: string | null): void => {
  console.log(
    `[Scholarly][ORCID] Beginning continuous badge injection for ${articles.length} articles...`,
  );

  injectOrcidStyles();

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
};