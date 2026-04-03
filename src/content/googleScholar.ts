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
  extra?: Record<string, unknown>;
}

function clearBadges(): void {
  document.querySelectorAll(".scholarly-badge").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-interactive-container").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-interactive-bubble").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-static-pill").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-q-tag").forEach((el) => el.remove());
  console.log("[Scholarly] Badges cleared");
}

function extractDoi(link: string): string | null {
  const match = link.match(/\b(10\.\d{4,}\/\S+)/);
  if (!match) return null;
  return match[1].replace(/[.,;)\]]+$/, "");
}

function isUserProfilePage(): boolean {
  return (
    /\/citations/.test(window.location.pathname) &&
    /user=/.test(window.location.search)
  );
}

function injectScholarlyStyles() {
  // Always replace to ensure latest styles
  document.getElementById("scholarly-styles")?.remove();
  const style = document.createElement("style");
  style.id = "scholarly-styles";
  style.textContent = `
    .scholarly-interactive-container {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      margin-left: 12px !important;
      vertical-align: middle !important;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      position: relative !important;
    }
    /* When any bubble inside is hovered, elevate the ENTIRE container above all siblings */
    .scholarly-interactive-container:has(.scholarly-interactive-bubble:hover) {
      z-index: 99999 !important;
    }
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
      min-width: 300px !important;
      max-width: 450px !important;
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
  `;
  document.head.appendChild(style);
}

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-.,]/g, " ").replace(/\s+/g, " ").trim();
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => runWorker()));
}

async function scrapeArticles(shouldContinue: () => boolean = () => true): Promise<void> {
  if (!shouldContinue()) return;
  clearBadges();
  injectScholarlyStyles();
  console.log("[Scholarly] Starting Google Scholar scrape...");

  try {
    const isProfile = isUserProfilePage();
    const selector = isProfile ? ".gsc_a_tr" : ".gs_r";
    const results = document.querySelectorAll(selector);
    
    const articles: any[] = [];
    results.forEach((row) => {
      try {
        let titleEl: HTMLElement | null = null;
        let badgeContainer: HTMLElement | null = null;
        let title = "";
        let linkEl: HTMLAnchorElement | null = null;

        if (isProfile) {
          titleEl = row.querySelector(".gsc_a_t") as HTMLElement | null;
          if (!titleEl) return;
          const titleLink = titleEl.querySelector("a");
          if (!titleLink) return;
          title = titleLink.innerText.trim();
          linkEl = titleLink;
          badgeContainer = titleLink;
        } else {
          titleEl = row.querySelector(".gs_rt") as HTMLElement | null;
          if (!titleEl) return;
          title = titleEl.innerText.trim();
          linkEl = titleEl.querySelector("a");
          badgeContainer = titleEl;
        }

        const link = linkEl ? linkEl.href : "";
        const doi = extractDoi(link);
        
        articles.push({ titleEl, badgeContainer: badgeContainer!, title, link, doi });
      } catch (e) { console.error(e); }
    });

    const scopusResults: any[] = new Array(articles.length).fill(null);
    await runWithConcurrency(articles, 3, async (article, index) => {
      if (article.doi && shouldContinue()) scopusResults[index] = await getScopusRankingByDoi(article.doi);
    });

    if (!shouldContinue()) return;

    articles.forEach((a, index) => {
      const ranking = scopusResults[index];
      if (!ranking) return;

      // Create or find the container
      let interactiveContainer = a.badgeContainer.querySelector(".scholarly-interactive-container") as HTMLElement | null;
      if (!interactiveContainer) {
        interactiveContainer = document.createElement("span");
        interactiveContainer.className = "scholarly-interactive-container";
        if (a.badgeContainer.tagName === "A") a.badgeContainer.insertAdjacentElement("afterend", interactiveContainer);
        else a.badgeContainer.appendChild(interactiveContainer);
      }
      // Clear to prevent duplication
      interactiveContainer.innerHTML = "";

      // 1. JR Bubble (Interactive — hover shows journal details)
      const jrBubble = document.createElement("div");
      jrBubble.className = "scholarly-interactive-bubble";

      const sjr = Number(ranking.sjr || 0);
      const q = ranking.sjrBestQuartile || "";
      const snip = Number(ranking.snip || 0);

      const rows = [
        ["Journal", ranking.title || "-"],
        ["Publisher", ranking.publisher || "-"],
        ["SJR", `${sjr.toFixed(3)} (${q || "-"})`],
        ["SNIP", snip > 0 ? snip.toFixed(3) : "-"],
        ["CiteScore", Number(ranking.citeScore || 0).toFixed(2)]
      ];
      const popHtml = rows.map(([l, v]) => `
        <div class="scholarly-popover-row">
          <span style="font-weight:600; color:#5f6368; font-size:12px;">${l}</span>
          <span style="color:#202124; font-size:12px; text-align:right;">${v}</span>
        </div>
      `).join("");

      jrBubble.innerHTML = `
        <div class="scholarly-badge-circle" style="background:#f1f3f4; color:#5f6368; border:1px solid #e1e4e8;">JR</div>
        <div class="scholarly-bubble-popover">
          <div style="font-size: 13px; font-weight:700; color:#1a73e8; margin-bottom:12px; border-bottom:1px solid #e8eaed; padding-bottom:8px;">Journal Ranking Details</div>
          ${popHtml}
          <div style="margin-top:10px; padding-top:8px; border-top:1px solid #e8eaed; font-size:10px; color:#70757a; text-align:center;">Powered by Scopus</div>
        </div>
      `;
      interactiveContainer.appendChild(jrBubble);

      // 2. SJR Pill (Static)
      let sjrColor = "#202124";
      if (sjr > 4) sjrColor = "#1a73e8"; else if (sjr > 1) sjrColor = "#188038";
      const sjrPill = document.createElement("span");
      sjrPill.className = "scholarly-static-pill";
      sjrPill.style.color = sjrColor;
      sjrPill.textContent = `SJR ${sjr.toFixed(3)}`;
      interactiveContainer.appendChild(sjrPill);

      // 3. Quartile Tag (Static)
      if (q) {
        let qBg = "#f1f3f4", qCol = "#5f6368";
        if (q === "Q1") { qBg = "#e6f4ea"; qCol = "#137333"; }
        else if (q === "Q2") { qBg = "#fef7e0"; qCol = "#b06000"; }
        else if (q === "Q3") { qBg = "#feefe3"; qCol = "#b06000"; }
        else if (q === "Q4") { qBg = "#fce8e6"; qCol = "#a50e0e"; }
        
        const qTag = document.createElement("span");
        qTag.className = "scholarly-q-tag";
        qTag.style.background = qBg;
        qTag.style.color = qCol;
        qTag.textContent = q;
        interactiveContainer.appendChild(qTag);
      }
    });
  } catch (error) { console.error("[Scholarly] Error during scraping:", error); }
}

function init(): void {
  if (!/scholar\.google\./i.test(window.location.hostname)) return;
  let runGeneration = 0;
  const maybeScrape = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const gen = ++runGeneration;
      const shouldContinue = () => gen === runGeneration;
      if (isGoogleScholarProfilePage()) await scrapeGoogleScholarProfile({ shouldContinue });
      else await scrapeArticles(shouldContinue);
    } else {
      runGeneration++;
      clearBadges();
      clearProfileBadges();
    }
  };
  getGoogleScholarEnabled().then(maybeScrape).catch(e => { console.error(e); maybeScrape(true); });
  if (chrome?.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "TOGGLE_CHANGED") {
        maybeScrape(Boolean(message.enabled)).then(() => sendResponse({ received: true, success: true }));
        return true;
      }
      sendResponse({ received: true });
    });
  }
}

export { init, scrapeArticles, clearBadges };
