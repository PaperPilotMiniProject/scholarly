/// <reference types="chrome" />

import { getScopusEnabled } from "../utils/storage";
import { getScopusAbstractByDoi, getScopusRankingByDoi } from "../utils/csvParser";

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const YEAR_PANEL_ID = "scholarly-scopus-year-panel";

function delay(ms) {
	return new Promise((res) => setTimeout(res, ms));
}

function clearBadges() {
	document
		.querySelectorAll(
			".scholarly-badge, .scholarly-badge-container",
		)
		.forEach((el) => el.remove());
}

function showLoadingState(message = "Loading Scholarly data...") {
	const existing = document.getElementById("scholarly-scopus-loading");
	if (existing) return;

	const panel = document.createElement("div");
	panel.id = "scholarly-scopus-loading";
	panel.setAttribute("role", "status");
	panel.setAttribute("aria-live", "polite");
	panel.style.cssText = `
		position: fixed;
		top: 16px;
		right: 16px;
		z-index: 2147483647;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: rgba(15, 23, 42, 0.96);
		color: #fff;
		border-radius: 999px;
		box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28);
		font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		font-size: 13px;
		font-weight: 700;
	`;

	const spinner = document.createElement("span");
	spinner.style.cssText = `
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.28);
		border-top-color: #ffffff;
		animation: scholarly-spin 0.8s linear infinite;
		flex: 0 0 auto;
	`;

	const label = document.createElement("span");
	label.textContent = message;

	panel.append(spinner, label);
	(document.body || document.documentElement).appendChild(panel);

	if (!document.getElementById("scholarly-spin-style")) {
		const style = document.createElement("style");
		style.id = "scholarly-spin-style";
		style.textContent = `
			@keyframes scholarly-spin {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}
		`;
		document.head.appendChild(style);
	}
}

function hideLoadingState() {
	document.getElementById("scholarly-scopus-loading")?.remove();
}

function badgeStyle(color) {
	return `
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: ${color};
		color: #fff;
		border-radius: 8px;
		font-weight: 700;
		font-size: 12px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
		line-height: 1.2;
		letter-spacing: 0.1px;
		white-space: nowrap;
		flex: 0 0 auto;
	`;
}

function buildRankingCard(scopusRanking) {
	const card = document.createElement("div");
	card.className = "scholarly-ranking-card";
	card.style.cssText = `
		margin-top: 10px;
		padding: 0;
		border: 1px solid #e5e7eb;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
		font-size: 12px;
		line-height: 1.45;
		min-width: 320px;
		overflow: hidden;
	`;

	const header = document.createElement("div");
	header.style.cssText = `
		padding: 12px 14px 10px;
		background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
		border-bottom: 1px solid #e5e7eb;
	`;

	const headerTitle = document.createElement("div");
	headerTitle.textContent = "Journal Ranking Details";
	headerTitle.style.cssText = `
		font-size: 14px;
		font-weight: 800;
		color: #2563eb;
		letter-spacing: 0.1px;
	`;

	header.appendChild(headerTitle);
	card.appendChild(header);

	const rows = [
		["Journal", scopusRanking.title || "-"],
		["Publisher", scopusRanking.publisher || "-"],
		["ISSN", (scopusRanking.issns || []).join(", ") || "-"],
		[
			"SJR",
			scopusRanking.sjr
				? `${Number(scopusRanking.sjr).toFixed(3)} (${scopusRanking.sjrYear || "-"})`
				: "-",
		],
		["Quartile", scopusRanking.sjrBestQuartile || "-"],
		[
			"SNIP",
			scopusRanking.snip
				? `${Number(scopusRanking.snip).toFixed(3)} (${scopusRanking.snipYear || "-"})`
				: "-",
		],
		[
			"CiteScore",
			scopusRanking.citeScore
				? `${Number(scopusRanking.citeScore).toFixed(2)} (${scopusRanking.citeScoreYear || "-"})`
				: "-",
		],
		[
			"Open Access",
			String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1"
				? "Yes"
				: "No",
		],
	];

	rows.forEach(([label, value], index) => {
		const row = document.createElement("div");
		row.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:7px 14px;";

		if (index % 2 === 1) {
			row.style.background = "#fbfdff";
		}

		const left = document.createElement("span");
		left.style.cssText = "font-weight:600;color:#334155;white-space:nowrap;";
		left.textContent = label;

		const right = document.createElement("span");
		right.style.cssText = "color:#0f172a;text-align:right;font-weight:500;";
		right.textContent = value;

		row.append(left, right);
		card.appendChild(row);
	});

	const footer = document.createElement("div");
	footer.style.cssText = `
		padding: 10px 14px 12px;
		border-top: 1px solid #eef2f7;
		text-align: center;
		color: #94a3b8;
		font-size: 11px;
	`;
	footer.textContent = "Powered by Scopus";
	card.appendChild(footer);

	return card;
}

function extractYearFromText(text) {
	const matches = String(text || "").match(/\b(19|20)\d{2}\b/g);
	return matches?.length ? matches[matches.length - 1] : null;
}

function extractArticleYear(container) {
	if (!container) return null;

	const yearNodes = container.querySelectorAll(
		"time, [data-testid*='year'], [class*='year'], [aria-label*='year']",
	);
	for (const node of yearNodes) {
		const year = extractYearFromText(node.textContent || node.innerText || "");
		if (year) return year;
	}

	return extractYearFromText(container.innerText || container.textContent || "");
}

function buildYearChart(byYear) {
	const entries = Object.entries(byYear)
		.sort(([a], [b]) => Number(a) - Number(b))
		.slice(-12);

	if (!entries.length) return "";

	const maxCount = Math.max(...entries.map(([, count]) => count));
	const barWidth = entries.length <= 4 ? 34 : entries.length <= 8 ? 26 : 20;
	const gap = entries.length <= 4 ? 10 : 8;
	const chartHeight = 72;
	const usedWidth = entries.length * (barWidth + gap);
	const totalWidth = Math.max(320, usedWidth);
	const xOffset = Math.max(0, (totalWidth - usedWidth) / 2);

	const bars = entries
		.map(([year, count], index) => {
			const barHeight = maxCount > 0 ? (count / maxCount) * chartHeight : 0;
			const x = xOffset + index * (barWidth + gap);
			const y = chartHeight - barHeight;

			return `
				<g>
					<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"
						fill="#2563eb" rx="4" opacity="0.88"/>
					<text x="${x + barWidth / 2}" y="${y - 4}"
						text-anchor="middle" font-size="8" font-weight="700" fill="#334155"
						font-family="system-ui, sans-serif">
						${count}
					</text>
					<text x="${x + barWidth / 2}" y="${chartHeight + 12}"
						text-anchor="middle" font-size="9" fill="#64748b"
						font-family="system-ui, sans-serif">
						${year}
					</text>
				</g>
			`;
		})
		.join("");

	return `
		<svg viewBox="0 0 ${totalWidth} ${chartHeight + 20}"
			width="${totalWidth}" height="${chartHeight + 20}"
			style="overflow:visible;display:block;">
			${bars}
		</svg>
	`;
}

function injectYearChartPanel(articles) {
	const byYear = {};
	let yearCount = 0;

	articles.forEach((article) => {
		const year = article.year || extractArticleYear(article.container);
		if (!year) return;
		byYear[year] = (byYear[year] || 0) + 1;
		yearCount += 1;
	});

	const chart = buildYearChart(byYear);
	if (!chart) return;

	document.getElementById(YEAR_PANEL_ID)?.remove();

	const panel = document.createElement("div");
	panel.id = YEAR_PANEL_ID;
	panel.style.cssText = `
		margin: 0 0 14px;
		width: min(100%, 980px);
		padding: 14px 16px;
		border: 1px solid #e5e7eb;
		border-radius: 14px;
		background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
		box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
		font-family: system-ui, sans-serif;
	`;

	const header = document.createElement("div");
	header.style.cssText = "display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap;";

	const title = document.createElement("div");
	title.textContent = "Publications per year";
	title.style.cssText = "font-size:14px;font-weight:800;color:#1d4ed8;letter-spacing:0.1px;";

	const subtitle = document.createElement("div");
	subtitle.textContent = `${yearCount} articles with year data`;
	subtitle.style.cssText = "font-size:12px;color:#64748b;";

	header.append(title, subtitle);

	const chartWrap = document.createElement("div");
	chartWrap.style.cssText = "overflow-x:auto;padding-bottom:2px;width:100%;";
	chartWrap.innerHTML = chart;

	panel.append(header, chartWrap);

	const firstArticle = articles.find((article) => article.container);
	const resultsHost =
		firstArticle?.container?.closest("[data-testid='results-list'], [data-testid='search-results-list']") ||
		firstArticle?.container?.parentElement ||
		firstArticle?.container?.closest("main, [role='main'], section");

	if (!resultsHost) return;

	if (firstArticle?.container?.parentElement === resultsHost) {
		resultsHost.insertBefore(panel, firstArticle.container);
		return;
	}

	resultsHost.prepend(panel);
}

function extractDoiFromText(text) {
	if (!text) return null;
	const match = String(text).match(DOI_REGEX);
	return match ? match[0].replace(/[.,;\])]+$/, "") : null;
}

function findDoiInContainer(container) {
	if (!container) return null;

	const doiAnchor = container.querySelector('a[href*="doi.org/"]');
	if (doiAnchor) {
		const direct = extractDoiFromText(doiAnchor.href) || extractDoiFromText(doiAnchor.textContent);
		if (direct) return direct;
	}

	// Look for text nodes that contain DOI patterns
	const textContent = container.textContent || "";
	const textMatch = extractDoiFromText(textContent);
	if (textMatch) return textMatch;

	return null;
}

function findTitleElement(container) {
	if (!container) return null;
	return (
		container.querySelector("[data-testid*='title'] a") ||
		container.querySelector("a[data-testid*='title']") ||
		container.querySelector("a[href*='/record/']") ||
		container.querySelector("a[href*='/record/display.uri']") ||
		container.querySelector("[data-test='result-title']") ||
		container.querySelector(".ddmDocTitle") ||
		container.querySelector("h2 a, h3 a") ||
		container.querySelector("h2, h3") ||
		container.querySelector("a")

	);
}

function toArray(value) {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function normalizeAuthorName(name) {
	return String(name || "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/,+$/, "");
}

function formatAuthorName(author) {
	if (!author) return "";

	const indexed = normalizeAuthorName(author["ce:indexed-name"] || author["dc:creator"] || "");
	if (indexed) return indexed;

	const surname = normalizeAuthorName(author["ce:surname"] || author.surname || "");
	const given = normalizeAuthorName(
		author["ce:given-name"] || author["ce:initials"] || author["preferred-name"]?.["ce:given-name"] || "",
	);

	if (surname && given) return `${surname}, ${given}`;
	return surname || given;
}

async function fetchAuthorsByDoi(doi) {
	try {
		const response = await getScopusAbstractByDoi(doi);
		if (!response?.success) return { firstAuthor: "", lastAuthor: "" };

		const names = [];
		const seen = new Set();

		const groups = toArray(response.authorGroup);
		groups.forEach((group) => {
			toArray(group?.author).forEach((author) => {
				const formatted = formatAuthorName(author);
				if (!formatted) return;
				const key = formatted.toLowerCase();
				if (seen.has(key)) return;
				seen.add(key);
				names.push(formatted);
			});
		});

		if (!names.length && response.correspondence?.author) {
			const correspondenceName = formatAuthorName(response.correspondence.author);
			if (correspondenceName) names.push(correspondenceName);
		}

		if (!names.length) return { firstAuthor: "", lastAuthor: "" };
		return {
			firstAuthor: names[0] || "",
			lastAuthor: names[names.length - 1] || "",
		};
	} catch (err) {
		console.warn(`[Scholarly][Scopus] Author API lookup failed for DOI ${doi}:`, err);
		return { firstAuthor: "", lastAuthor: "" };
	}
}
async function getDoiFromTitle(title) {
  try {
		const params = new URLSearchParams({
			"query.bibliographic": title,
			rows: "5",
			select: "DOI,title,score",
			mailto: "scholarly-extension@example.com",
		});
		const res = await fetch(
			`https://api.crossref.org/works?${params.toString()}`
		);
    const data = await res.json();
		const items = data?.message?.items || [];
		if (!items.length) return null;

		const normalize = (s) =>
			String(s || "")
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, " ")
				.replace(/\s+/g, " ")
				.trim();

		const titleNorm = normalize(title);
		const scored = items
			.map((item) => {
				const candidateTitle = Array.isArray(item?.title)
					? item.title[0] || ""
					: item?.title || "";
				const candidateNorm = normalize(candidateTitle);
				let score = Number(item?.score || 0);
				if (candidateNorm && titleNorm) {
					if (candidateNorm === titleNorm) score += 120;
					else if (candidateNorm.includes(titleNorm) || titleNorm.includes(candidateNorm)) score += 60;
				}
				return { doi: item?.DOI || null, score };
			})
			.filter((x) => x.doi)
			.sort((a, b) => b.score - a.score);

		return scored[0]?.doi || null;
  } catch (e) {
    console.error("Crossref error", e);
    return null;
  }
}
const SELECTOR = `
	a[href*="/pages/publications/"],
	a[href*="/record/display.uri"],
	a[href*="/record/"],
	a[data-testid*="title"]
`;

const RESULT_CONTAINER_SELECTOR = `
	[data-testid='results-list-item'],
	[data-testid*='result-item'],
	li[data-testid*='result'],
	article
`;

function isLikelyPublicationLink(el) {
	const href = String(el?.getAttribute?.("href") || "");
	if (!href) return false;

	if (
		href.includes("/record/display.uri") ||
		href.includes("/record/") ||
		href.includes("/pages/publications/")
	) {
		return true;
	}

	return false;
}

// Collect article cards from the Scopus results list.
function collectArticles() {
	const articles = [];
	const seenKeys = new Set();

	// Prefer scanning result rows first; this survives link/DOM changes better.
	document.querySelectorAll(RESULT_CONTAINER_SELECTOR).forEach((container) => {
		const titleEl = findTitleElement(container);
		if (!titleEl || !isLikelyPublicationLink(titleEl)) return;
		const title = titleEl?.innerText?.trim() || titleEl?.textContent?.trim() || "";
		if (!title || title.length < 5) return;

		const href = titleEl?.getAttribute?.("href") || "";
		const key = `${title.toLowerCase()}|${href}`;
		if (seenKeys.has(key)) return;
		seenKeys.add(key);

		const year = extractArticleYear(container);
		articles.push({
			title,
			container,
			titleEl: titleEl || container,
			firstAuthor: "",
			lastAuthor: "",
			year,
		});
	});

	if (!articles.length) {
		document.querySelectorAll(SELECTOR).forEach((el) => {
			if (!isLikelyPublicationLink(el)) return;
			const title = el.innerText?.trim() || el.textContent?.trim() || "";
			if (!title || title.length < 5) return;

			const href = el.getAttribute?.("href") || "";
			const key = `${title.toLowerCase()}|${href}`;
			if (seenKeys.has(key)) return;
			seenKeys.add(key);

			const container =
				el.closest("[data-testid='results-list-item']") ||
				el.closest("article") ||
				el.closest("li") ||
				el.closest("tr") ||
				el.parentElement ||
				el;
			const year = extractArticleYear(container);

			articles.push({
				title,
				container,
				titleEl: el,
				firstAuthor: "",
				lastAuthor: "",
				year,
			});
		});
	}

	console.log("Articles found:", articles.length);

	return articles;
}
async function annotateArticle(article, scopusRanking) {
	if (!scopusRanking || !article.titleEl) return;

	// Avoid duplicating badges on the same result row
	if (article.container?.querySelector(".scholarly-badge-container")) return;

	const container = document.createElement("div");
	container.className = "scholarly-badge-container";
	container.style.cssText = `
		margin-top: 8px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		max-width: 100%;
		padding-top: 2px;
	`;

	const sjr = document.createElement("span");
	sjr.textContent = scopusRanking.sjr
		? `SJR ${Number(scopusRanking.sjr).toFixed(3)}${scopusRanking.sjrBestQuartile ? ` (${scopusRanking.sjrBestQuartile})` : ""}`
		: "SJR -";
	sjr.style.cssText = badgeStyle("#3b5fde");

	const snip = document.createElement("span");
	snip.textContent = scopusRanking.snip
		? `SNIP ${Number(scopusRanking.snip).toFixed(3)}${scopusRanking.snipYear ? ` (${scopusRanking.snipYear})` : ""}`
		: "SNIP -";
	snip.style.cssText = badgeStyle("#e8751a");

	const cite = document.createElement("span");
	cite.textContent = scopusRanking.citeScore
		? `CiteScore ${Number(scopusRanking.citeScore).toFixed(2)}${scopusRanking.citeScoreYear ? ` (${scopusRanking.citeScoreYear})` : ""}`
		: "CiteScore -";
	cite.style.cssText = badgeStyle("#0f9d58");

	const hIndexValue = String(scopusRanking.hIndex || "").trim();
	const hIndexBadge = document.createElement("span");
	hIndexBadge.textContent = hIndexValue ? `H-index ${hIndexValue}` : "H-index -";
	hIndexBadge.style.cssText = badgeStyle(hIndexValue ? "#2563eb" : "#6c757d");

	const isOpenAccess =
		String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1";
	const oa = document.createElement("span");
	oa.textContent = isOpenAccess ? "Open Access: Yes" : "Open Access: No";
	oa.style.cssText = badgeStyle(isOpenAccess ? "#2e7d32" : "#6c757d");

	const quartile = String(scopusRanking.sjrBestQuartile || "").trim();
	const quartileBadge = document.createElement("span");
	quartileBadge.textContent = quartile || "Q-";
	quartileBadge.style.cssText = badgeStyle(
		quartile === "Q1"
			? "#137333"
			: quartile === "Q2"
				? "#b06000"
				: "#6c757d",
	);

	const firstAuthorBadge = document.createElement("span");
	firstAuthorBadge.textContent = article.firstAuthor
		? `1st: ${article.firstAuthor}`
		: "1st: -";
	firstAuthorBadge.style.cssText = badgeStyle(article.firstAuthor ? "#5b21b6" : "#6c757d");

	const lastAuthorBadge = document.createElement("span");
	lastAuthorBadge.textContent = article.lastAuthor
		? `Last: ${article.lastAuthor}`
		: "Last: -";
	lastAuthorBadge.style.cssText = badgeStyle(article.lastAuthor ? "#7c3aed" : "#6c757d");

	const cardToggle = document.createElement("button");
	cardToggle.type = "button";
	cardToggle.textContent = "Ranking card";
	cardToggle.className = "scholarly-badge";
	cardToggle.style.cssText =
		"display:inline-flex;align-items:center;padding:4px 10px;background:#ffffff;color:#0f172a;border:1px solid #dbe3ea;" +
		"border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,0.06);";

	let cardEl = null;
	cardToggle.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		if (cardEl && cardEl.isConnected) {
			cardEl.remove();
			cardEl = null;
			return;
		}
		cardEl = buildRankingCard(scopusRanking);
		container.appendChild(cardEl);
	});

	container.append(
		cardToggle,
		quartileBadge,
		firstAuthorBadge,
		lastAuthorBadge,
		hIndexBadge,
		snip,
		cite,
		oa,
		sjr,
	);

	const insertionHost = article.titleEl.parentElement || article.container || article.titleEl;
	insertionHost.insertAdjacentElement("afterend", container);
}

async function scrapeScopus(shouldContinue) {
	if (!shouldContinue()) return;

	console.log("[Scholarly][Scopus] Starting scrape...");
	showLoadingState("Loading Scholarly badges...");

	try {
		const articles = collectArticles();
		console.log(`[Scholarly][Scopus] Found ${articles.length} articles`);
		injectYearChartPanel(articles);

		if (!articles.length) {
			console.info(
				"[Scholarly][Scopus] No DOIs found on this page. Try opening search results or an article list.",
			);
			return;
		}

		for (const [index, article] of articles.entries()) {
			if (!shouldContinue()) break;

			// Be polite to remote APIs; space requests.
			await delay(1000);

			// Prefer an in-page DOI if available; fall back to CrossRef lookup by title
			const directDoi = findDoiInContainer(article.container);
			let doi = directDoi;
			if (!doi) {
				doi = await getDoiFromTitle(article.title);
			}

			if (!doi) {
				console.warn(`[Scholarly][Scopus] ✗ No DOI found for title: ${article.title}`);
				continue;
			}

			// If fallback DOI is reused for many titles, skip to avoid wrong repeated journal ranking.
			if (!directDoi) {
				const duplicateDoiCount = articles.filter((a) => {
					const txt = a?.container?.textContent || "";
					return txt.includes(doi);
				}).length;
				if (duplicateDoiCount > 1) {
					console.warn(
						`[Scholarly][Scopus] Skipping ambiguous DOI fallback ${doi} for title: ${article.title}`,
					);
					continue;
				}
			}

			console.log(`[Scholarly][Scopus] → DOI: ${doi} | Title: ${article.title.slice(0, 120)}`);

			const authorData = await fetchAuthorsByDoi(doi);
			article.firstAuthor = authorData.firstAuthor || "";
			article.lastAuthor = authorData.lastAuthor || "";

			const ranking = await getScopusRankingByDoi(doi);
			if (ranking) {
				console.log(
					`[Scholarly][Scopus] ✓ SJR ${ranking.sjr ?? "-"} (${ranking.sjrYear ?? "-"}) | SNIP ${ranking.snip ?? "-"} (${ranking.snipYear ?? "-"}) | Title ${ranking.title} | ISSN ${(ranking.issns || []).join(", ")}`,
				);
				await annotateArticle(article, ranking);
			} else {
				console.warn(
					`No Scopus ranking for ${doi}`
				);
			}
		}
	} finally {
		hideLoadingState();
	}
}

export function init() {
	if (!/\.scopus\.com$/i.test(window.location.hostname)) return;

	console.log(
		`[Scholarly][Scopus] Content script active on ${window.location.pathname}`,
	);
	showLoadingState("Loading Scholarly extension...");

	let runGeneration = 0;
	const nextGeneration = () => {
		runGeneration += 1;
		return runGeneration;
	};

	const maybeScrape = async (enabled) => {
		if (!enabled) {
			console.log("[Scholarly][Scopus] Disabled by toggle; clearing badges");
			clearBadges();
			hideLoadingState();
			nextGeneration();
			return;
		}

		const currentGeneration = nextGeneration();
		const shouldContinue = () => currentGeneration === runGeneration;

		let scrapeTimeout;
		const triggerScrape = () => {
			clearTimeout(scrapeTimeout);
			scrapeTimeout = setTimeout(() => {
				if (!shouldContinue()) return;
				scrapeScopus(shouldContinue);
			}, 3000);
		};

		const observer = new MutationObserver(() => {
			console.log("[Scholarly][Scopus] DOM changed, scheduling scrape...");
			triggerScrape();
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		triggerScrape();
	};

	getScopusEnabled()
		.then((enabled) => {
			console.log(`[Scholarly][Scopus] Initial enabled state: ${enabled}`);
			return maybeScrape(enabled);
		})
		.catch((err) => {
			console.error("[Scholarly][Scopus] Failed to read toggle state", err);
			maybeScrape(true);
		});

	if (chrome && chrome.runtime) {
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "TOGGLE_SCOPUS_CHANGED") {
				maybeScrape(Boolean(message.enabled));
			}
		});
	}
}

export { clearBadges as clearScopusBadges };