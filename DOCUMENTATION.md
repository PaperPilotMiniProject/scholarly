# Scholarly Chrome Extension - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Project Structure](#project-structure)
3. [TypeScript Basics for JS Developers](#typescript-basics)
4. [Chrome Extension Architecture](#chrome-extension-architecture)
5. [Data Flow](#data-flow)
6. [File-by-File Explanation](#file-by-file-explanation)
7. [How to Add New Data Sources](#how-to-add-new-data-sources)
8. [Common Tasks](#common-tasks)

---

## Overview

**Scholarly** is a Chrome extension that:

1. Monitors Google Scholar pages when you visit them
2. Extracts article data (title, journal, citations)
3. Looks up journal rankings from an SJR CSV file
4. Displays ranking badges directly in Google Scholar results

The key insight: **Different parts of the extension run in different contexts with different capabilities**, so data flows between them.

---

## Project Structure

```
scholarly/
├── entrypoints/
│   ├── background.ts          ← Background script (runs once, has full API access)
│   ├── content.ts             ← Content script (runs on every page)
│   └── popup/
│       ├── App.tsx            ← React popup UI (shows toggle switch)
│       ├── index.html
│       └── main.tsx
├── src/
│   ├── background/
│   │   └── rankings.ts        ← CSV loading logic (runs in background)
│   ├── content/
│   │   └── googleScholar.ts   ← Google Scholar scraping logic
│   ├── utils/
│   │   ├── storage.ts         ← Persistent storage helper
│   │   └── csvParser.ts       ← Ranking lookup helper
│   └── services/
│       └── (future data sources)
├── public/data/
│   └── scimagojr_2024.csv     ← Ranking data file
├── lib/
│   └── papaparse.min.js       ← CSV parsing library (not used now)
├── wxt.config.ts              ← Build configuration
├── tsconfig.json              ← TypeScript configuration
└── package.json               ← Dependencies

```

---

## TypeScript Basics

Coming from JavaScript, here's what's different in TypeScript:

### 1. **Type Annotations**

```typescript
// JavaScript
function greet(name) {
  return "Hello " + name;
}

// TypeScript - specify what types go in and come out
function greet(name: string): string {
  return "Hello " + name;
}

// For variables
const count: number = 5;
const isActive: boolean = true;
const items: string[] = ["apple", "banana"];
```

### 2. **Interfaces** (like blueprints)

```typescript
// Define the shape of an object
interface Article {
  title: string;
  journal?: string; // ? means optional
  citations?: number;
  ranking?: JournalRanking;
  extra?: Record<string, unknown>;
}

// Now when you create an Article, TypeScript checks it matches
const myArticle: Article = {
  title: "Machine Learning",
  citations: 42,
};
```

### 3. **Async/Promise**

```typescript
// Fetching data takes time, so we use async/await
async function loadData(): Promise<string> {
  const response = await fetch(url);
  const text = await response.text();
  return text;
}

// When you call it, you need to wait for the result
const data = await loadData();
```

### 4. **Type vs Interface** (you'll see both)

```typescript
// Interface - for objects that define shapes/contracts
interface User {
  id: number;
  name: string;
}

// Type - more flexible, can be used for anything
type Status = "loading" | "success" | "error";
type ID = string | number;
```

---

## Chrome Extension Architecture

A Chrome extension has **three main contexts**, each with different powers:

### **1. Background Script** (`entrypoints/background.ts`)

- **Where it runs:** In the browser itself, not on any webpage
- **What it can do:** Full Chrome API access (storage, messaging, tabs)
- **When it runs:** Once when the extension starts
- **What it can't do:** Can't access webpage DOM (can't see Google Scholar HTML)
- **Good for:** Loading big files, managing data, coordinating between parts

### **2. Content Script** (`entrypoints/content.ts`)

- **Where it runs:** Injected into every webpage
- **What it can do:** Read/modify webpage HTML (DOM), see page content
- **When it runs:** Every time you load a page
- **What it can't do:** Limited Chrome API access (can't fetch files from extension)
- **Good for:** Scraping, reading page data, showing badges on the page

### **3. Popup Script** (`entrypoints/popup/App.tsx`)

- **Where it runs:** Inside the extension popup window
- **What it can do:** Full Chrome API access, React UI
- **When it runs:** Only when you click the extension icon
- **What it can't do:** Can't see webpage content directly
- **Good for:** User interface, settings, controls

### **Data Communication Between Contexts**

They can't directly access each other's data, so they communicate via **messages**:

```
Popup (toggle switch clicked)
  ↓ sends chrome.runtime.sendMessage({ type: "TOGGLE_CHANGED", enabled: true })
Background (receives message)
  ↓ stores in chrome.storage.local
  ↓ sends reply
Popup (gets reply)
  ↓ also calls chrome.tabs.sendMessage to all Scholar tabs
Content Script (receives message on Scholar page)
  ↓ runs scraping function
  ↓ displays badges
```

---

## Data Flow

Here's the **complete journey** of data through the extension:

### **Step 1: User Toggles the Switch**

**File:** `entrypoints/popup/App.tsx`

```tsx
const toggle = (e: React.ChangeEvent<HTMLInputElement>) => {
  const newVal = e.target.checked; // true or false
  setEnabled(newVal); // update UI
  setGoogleScholarEnabled(newVal); // save to storage

  // Tell all Scholar tabs about the toggle
  if (chrome && chrome.tabs) {
    chrome.tabs.query({ url: "*://*.google.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: "TOGGLE_CHANGED",
            enabled: newVal,
          });
        }
      });
    });
  }
};
```

**What happens:**

- User clicks toggle → React state updates
- `setGoogleScholarEnabled(true/false)` saves to storage
- `chrome.tabs.sendMessage()` tells content scripts on Scholar pages

---

### **Step 2: Content Script Receives Toggle Message**

**File:** `src/content/googleScholar.ts` (inside the `init()` function)

```typescript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Scholarly] Received message:", message);
  if (message.type === "TOGGLE_CHANGED") {
    console.log(`[Scholarly] Toggle changed to: ${message.enabled}`);
    maybeScrape(Boolean(message.enabled)) // Call scraping function
      .then(() => {
        sendResponse({ received: true, success: true });
      })
      .catch((error) => {
        console.error("[Scholarly] Error during scraping:", error);
        sendResponse({ received: true, success: false, error });
      });
    return true; // Keep the channel open for async response
  }
});
```

**What happens:**

- Content script is listening for messages
- When toggle arrives, it calls `maybeScrape(true)` or `maybeScrape(false)`
- Returns response to popup to confirm receipt

---

### **Step 3: Request Rankings from Background**

**File:** `src/content/googleScholar.ts` (inside `scrapeArticles()`)

```typescript
async function scrapeArticles(): Promise<void> {
  console.log("[Scholarly] Starting Google Scholar scrape...");

  try {
    // Request rankings from background script
    console.log("[Scholarly] About to load SJR rankings...");
    const rankings = await loadSJRData();  // ← KEY CALL
    console.log(`[Scholarly] Finished loading. Total rankings: ${rankings.length}`);
```

**What happens:**

- Content script can't load files directly (security restriction)
- So it requests from background via `loadSJRData()`
- This is in `csvParser.ts`

---

### **Step 4: Load Rankings in Background**

**File:** `src/utils/csvParser.ts` (content script version)

```typescript
export async function loadSJRData(): Promise<JournalRanking[]> {
  try {
    console.log("[Scholarly] Requesting SJR rankings from background...");

    return new Promise((resolve, reject) => {
      // Send message to background script
      chrome.runtime.sendMessage(
        { type: "LOAD_RANKINGS" }, // Request signal
        (response) => {
          // Callback when response arrives
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }

          if (response && response.success) {
            console.log(
              `[Scholarly] Received ${response.data.length} rankings`,
            );
            resolve(response.data); // Return the rankings
          } else {
            reject(new Error(response.error));
          }
        },
      );
    });
  } catch (error) {
    console.error("[Scholarly] Error loading SJR data:", error);
    return [];
  }
}
```

**What happens:**

- Sends `{ type: "LOAD_RANKINGS" }` message to background
- Waits for response with `new Promise()`
- When background responds, it resolves with the rankings array

---

### **Step 5: Background Loads and Parses CSV**

**File:** `src/background/rankings.ts`

```typescript
let cachedRankings: JournalRanking[] | null = null;

// Message handler
if (chrome && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "LOAD_RANKINGS") {
      console.log("[Scholarly BG] Received LOAD_RANKINGS request");
      loadRankings() // ← Loads from CSV
        .then((rankings) => {
          console.log(`[Scholarly BG] Sending ${rankings.length} rankings`);
          sendResponse({ success: true, data: rankings }); // ← Send back
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open
    }
  });
}

async function loadRankings(): Promise<JournalRanking[]> {
  // Check cache first (fast!)
  if (cachedRankings) {
    return cachedRankings;
  }

  try {
    console.log("[Scholarly BG] Loading CSV...");
    const csvUrl = chrome.runtime.getURL("data/scimagojr 2024.csv");

    // Fetch the CSV file
    const response = await fetch(csvUrl);
    const csvContent = await response.text();

    // Parse it
    cachedRankings = parseCSV(csvContent);
    console.log(`[Scholarly BG] Parsed ${cachedRankings.length} rankings`);

    return cachedRankings;
  } catch (error) {
    console.error("[Scholarly BG] Error loading rankings:", error);
    return [];
  }
}
```

**What happens:**

- Background receives `LOAD_RANKINGS` message
- Calls `loadRankings()` which fetches `scimagojr_2024.csv`
- Parses CSV using `parseCSV()` function
- Caches it in memory (next calls are instant)
- Sends back array of `JournalRanking` objects

**CSV Parsing:** `parseCSV(csvContent)` breaks the CSV into objects:

```typescript
// Input CSV line:
// Rank;Title;SJR;SJR Best Quartile;...
// 1;"Nature";"18.288";"Q1";...

// Output JournalRanking object:
{
  rank: 1,
  title: "Nature",
  sjr: 18.288,
  quartile: "Q1",
  hjIndex: 1442,
  category: "Multidisciplinary (Q1)",
  sources: { csvRow: {...} }
}
```

---

### **Step 6: Content Script Scrapes Articles**

Back in **`src/content/googleScholar.ts`**, now with rankings loaded:

```typescript
const collected: Article[] = [];

// Google Scholar HTML structure:
// <div class="gs_r">           ← Article container
//   <h3 class="gs_rt">         ← Title/link
//   <div class="gs_a">         ← Authors/journal/year
//   <div class="gs_fl">        ← Citation count link

const results = document.querySelectorAll(".gs_r");
console.log(`[Scholarly] Found ${results.length} result containers`);

results.forEach((row, index) => {
  try {
    // 1. Extract title
    const titleEl = row.querySelector(".gs_rt") as HTMLElement | null;
    const title = titleEl?.innerText.trim() || "";
    const linkEl = titleEl?.querySelector("a") as HTMLAnchorElement | null;
    const link = linkEl?.href || "";

    // 2. Extract journal, year, citations
    let journal = "";
    let year = "";
    let citations = 0;

    const sourceEl = row.querySelector(".gs_a") as HTMLElement | null;
    if (sourceEl) {
      const sourceText = sourceEl.innerText;
      // sourceText looks like: "Authors - Journal Name - 2024"
      let parts = sourceText.split(" - ");
      if (parts.length >= 2) {
        journal = parts[1].trim();
        const yearMatch = sourceText.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = yearMatch[0];
      }
    }

    // Extract citation count from "Cited by X" link
    const fl = row.querySelectorAll(".gs_fl a");
    fl.forEach((a) => {
      const t = a.textContent || "";
      if (t.startsWith("Cited by")) {
        const num = parseInt(t.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num)) citations = num;
      }
    });

    // 3. Create article object
    const article: Article = {
      title,
      link,
      journal,
      year,
      citations,
      extra: {},
    };

    // 4. Match journal with ranking
    if (journal && rankings.length > 0) {
      const ranking = findRanking(journal, rankings);
      if (ranking) {
        article.ranking = ranking;

        // 5. INJECT BADGES INTO DOM
        const badge = document.createElement("span");
        badge.style.cssText =
          "margin-left:8px;padding:2px 4px;background:#ffeb3b;color:#000;font-size:10px;border-radius:3px;";
        badge.textContent = `SJR ${ranking.sjr} (Q${ranking.quartile})`;
        titleEl?.appendChild(badge); // ← Add yellow badge

        if (citations) {
          const citeBadge = document.createElement("span");
          citeBadge.style.cssText =
            "margin-left:4px;padding:2px 4px;background:#c8e6c9;color:#000;font-size:10px;border-radius:3px;";
          citeBadge.textContent = `Cited by ${citations}`;
          titleEl?.appendChild(citeBadge); // ← Add green badge
        }
      }
    }

    collected.push(article);
  } catch (error) {
    console.error(`[Scholarly] Error parsing result ${index}:`, error);
  }
});
```

**What happens:**

- Uses CSS selectors (`.gs_r`, `.gs_rt`, etc.) to find article elements
- Pulls out text content from the HTML
- Matches journal name against the rankings array
- **Creates new DOM elements (badges)** and appends them to the title
- Collects all articles into an array

---

## File-by-File Explanation

### **1. `entrypoints/popup/App.tsx` - The UI**

```tsx
import React, { useState, useEffect } from "react";
import {
  getGoogleScholarEnabled,
  setGoogleScholarEnabled,
} from "@/utils/storage";

export default function App() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load current state when popup opens
  useEffect(() => {
    getGoogleScholarEnabled().then((value) => {
      setEnabled(value);
      setLoading(false);
    });
  }, []);

  // When user toggles
  const toggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setEnabled(newVal);
    setGoogleScholarEnabled(newVal);

    // Tell Scholar pages about the change
    chrome.tabs.query({ url: "*://*.google.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: "TOGGLE_CHANGED",
              enabled: newVal,
            })
            .catch(() => {
              // Tab doesn't have content script, that's ok
            });
        }
      });
    });
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Scholarly</h2>
      <label>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Enable Google Scholar Scraping
      </label>
    </div>
  );
}
```

**Key points:**

- `useState` = React way to store changing data (like `let` but reactive)
- `useEffect(..., [])` = Run once when component loads
- `chrome.tabs.sendMessage()` = Send message to all Scholar tabs

---

### **2. `entrypoints/background.ts` - The Engine**

```typescript
import "@/background/rankings";

export default defineBackground(() => {
  console.log("[Scholarly] Background service worker initialized");
});
```

**Key points:**

- Imports the `rankings.ts` module to activate its message listener
- Runs once, persists for the extension lifetime
- Good place to put message handlers

---

### **3. `src/background/rankings.ts` - CSV Loading Hub**

```typescript
let cachedRankings: JournalRanking[] | null = null; // Cache in memory

// Listen for "LOAD_RANKINGS" messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOAD_RANKINGS") {
    loadRankings()
      .then((rankings) => {
        sendResponse({ success: true, data: rankings });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Important: keeps the message channel open for async
  }
});

async function loadRankings(): Promise<JournalRanking[]> {
  // Check cache first
  if (cachedRankings) return cachedRankings;

  const csvUrl = chrome.runtime.getURL("data/scimagojr 2024.csv");
  const response = await fetch(csvUrl);
  const csvContent = await response.text();

  cachedRankings = parseCSV(csvContent);
  return cachedRankings;
}

function parseCSV(content: string): JournalRanking[] {
  const lines = content.split("\n");
  const headers = parseCSVLine(lines[0]);

  // Get column positions
  const rankIndex = headers.indexOf("Rank");
  const titleIndex = headers.indexOf("Title");
  // ... etc

  const rankings: JournalRanking[] = [];

  // Parse each line
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);

    const ranking = {
      rank: parseInt(row[rankIndex], 10),
      title: row[titleIndex].replace(/^"(.*)"$/, "$1"),
      sjr: parseFloat(row[sjrIndex]),
      // ... etc
    };

    rankings.push(ranking);
  }

  return rankings;
}
```

**Key points:**

- `let cachedRankings` = Persists in memory while extension is open
- `chrome.runtime.getURL()` = Access extension files (ONLY works in background!)
- `parseCSVLine()` = Splits semicolon, handles quoted fields
- `return true` = Keep message channel open for async response

---

### **4. `entrypoints/content.ts` - The Injector**

```typescript
import { init } from "@/content/googleScholar";

export default defineContentScript({
  matches: ["*://*.google.com/*"], // Only run on Google Scholar
  main() {
    console.log("[Scholarly] Content script loaded");
    init(); // Start the scraper
  },
});
```

**Key points:**

- `matches: ["*://*.google.com/*"]` = Pattern for which pages to run on
- `main()` = Entry point (runs when page loads)

---

### **5. `src/content/googleScholar.ts` - The Scraper**

This is the **main logic file**. It:

1. **Initializes** when page loads - called by `content.ts`
2. **Listens for messages** from popup
3. **Loads rankings** from background
4. **Scrapes Google Scholar HTML**
5. **Matches journals with rankings**
6. **Injects badges into the DOM**

Key function: `scrapeArticles()` - Does all the work

---

### **6. `src/utils/storage.ts` - Persistent Data**

```typescript
import {
  getGoogleScholarEnabled,
  setGoogleScholarEnabled,
} from "@/utils/storage";

export async function getGoogleScholarEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get("googleScholarEnabled");
    return result.googleScholarEnabled ?? false;
  } catch {
    // Fallback to localStorage for testing
    return localStorage.getItem("googleScholarEnabled") === "true";
  }
}

export async function setGoogleScholarEnabled(enabled: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ googleScholarEnabled: enabled });
  } catch {
    localStorage.setItem("googleScholarEnabled", String(enabled));
  }
}
```

**Key points:**

- `chrome.storage.local` = Built-in extension storage (persists across sessions)
- `??` = Nullish coalescing (if null/undefined, use right side)
- Fallback to `localStorage` for testing

---

### **7. `src/utils/csvParser.ts` - Ranking Lookup**

```typescript
export async function loadSJRData(): Promise<JournalRanking[]> {
  // Sends message to background
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "LOAD_RANKINGS" }, (response) => {
      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

export function findRanking(
  journalTitle: string,
  rankings: JournalRanking[],
): JournalRanking | null {
  // 1. Normalize: "Nature Reviews" → "nature reviews"
  const normalized = normalizeTitle(journalTitle);

  // 2. Try exact match
  for (const ranking of rankings) {
    if (normalizeTitle(ranking.title) === normalized) {
      return ranking;
    }
  }

  // 3. Try substring match
  for (const ranking of rankings) {
    const rankingTitle = normalizeTitle(ranking.title);
    if (
      rankingTitle.includes(normalized) ||
      normalized.includes(rankingTitle)
    ) {
      return ranking;
    }
  }

  // 4. Try partial word match (80% match)
  const searchWords = normalized.split(" ").filter((w) => w.length > 3);
  for (const ranking of rankings) {
    const rankingTitle = normalizeTitle(ranking.title);
    const rankingWords = rankingTitle.split(" ");
    const matchCount = searchWords.filter((w) =>
      rankingWords.some((rw) => rw.includes(w)),
    ).length;
    if (matchCount >= Math.max(1, searchWords.length - 1)) {
      return ranking;
    }
  }

  return null;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars
    .replace(/\s+/g, " ") // Collapse spaces
    .trim();
}
```

**Key points:**

- **Matching strategy:** Tries exact → substring → partial (fuzzy)
- **Normalization:** Converts "Nature-Reviews (2024)" to "nature reviews"
- Returns first match found

---

## How to Add New Data Sources

The design allows **multiple ranking sources** as fallbacks.

### **Example: Add Scopus Rankings**

**Step 1: Create new data loader** (`src/background/scopusRankings.ts`)

```typescript
// Similar structure to rankings.ts but for Scopus data

async function loadScopusRankings(): Promise<ScopusRanking[]> {
  const csvUrl = chrome.runtime.getURL("data/scopus_rankings.csv");
  const response = await fetch(csvUrl);
  const csvContent = await response.text();
  return parseCSVForScopus(csvContent);
}

export interface ScopusRanking {
  rank: number;
  title: string;
  sjrScore: number; // Different field name
  percentile: number;
}
```

**Step 2: Add message handler** in `entrypoints/background.ts`

```typescript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOAD_SCOPUS_RANKINGS") {
    loadScopusRankings()
      .then((rankings) => {
        sendResponse({ success: true, data: rankings });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
```

**Step 3: Add lookup function** (`src/content/googleScholar.ts`)

```typescript
// Request both SJR and Scopus
const sjrRankings = await loadSJRData();
const scopusRankings = await loadScopusRankings();

// When displaying, try SJR first, then Scopus
let ranking = findRanking(journal, sjrRankings);
if (!ranking && scopusRankings) {
  ranking = findScopusRanking(journal, scopusRankings);
}

// Store both in the article
article.extra = {
  sjr: ranking,
  scopus: scopusRanking,
};
```

**Step 4: Display on badge**

```typescript
if (ranking) {
  const badge = document.createElement("span");
  badge.textContent = `SJR ${ranking.sjr} | Scopus ${ranking.scopus?.percentile}%`;
  titleEl.appendChild(badge);
}
```

---

## Common Tasks

### **Task 1: Change Badge Colors**

**File:** `src/content/googleScholar.ts` (line ~145)

```typescript
// Yellow badge for SJR
badge.style.cssText = "background:#ffeb3b;color:#000;"; // ← Change here
// Yellow = #ffeb3b, Green = #4caf50, Blue = #2196f3, Red = #f44336

// Green badge for citations
citeBadge.style.cssText = "background:#c8e6c9;color:#000;"; // ← Or here
```

### **Task 2: Change Badge Text**

**File:** `src/content/googleScholar.ts` (line ~149)

```typescript
badge.textContent = `SJR ${ranking.sjr} (Q${ranking.quartile})`;
// Change to whatever you want, e.g.:
// badge.textContent = `Rank: ${ranking.rank}`;
```

### **Task 3: Add a New Scraped Field**

**File 1:** `src/content/googleScholar.ts` (update Article interface)

```typescript
interface Article {
  title: string;
  link: string;
  journal?: string;
  year?: string;
  citations?: number;
  doi?: string; // ← NEW FIELD
  ranking?: JournalRanking;
  extra?: Record<string, unknown>;
}
```

**File 2:** Still in `googleScholar.ts` (extract from DOM)

```typescript
// Inside the scraping loop
let doi = "";
const doiLink = row.querySelector(
  'a[href*="doi.org"]',
) as HTMLAnchorElement | null;
if (doiLink) {
  doi = doiLink.href; // e.g., "https://doi.org/10.1234/..."
}

// Add to article
const article: Article = {
  title,
  link,
  journal,
  year,
  citations,
  doi, // ← NEW
  extra: {},
};
```

### **Task 4: Debug Why Something Isn't Working**

**Open the DevTools Console:**

1. **On Google Scholar page:**
   - Right-click → Inspect
   - Console tab
   - Look for `[Scholarly]` logs

2. **For popup errors:**
   - `chrome://extensions/`
   - Find Scholarly → Details → Errors

3. **For background script:**
   - `chrome://extensions/`
   - Find Scholarly → "Service Worker" link

4. **Common logs to watch:**
   ```
   [Scholarly] Content script loaded          ← Content script started
   [Scholarly BG] Received LOAD_RANKINGS       ← Background got request
   [Scholarly BG] Parsed XXXXX rankings        ← CSV loaded
   [Scholarly] Found 10 result containers      ← Scraping started
   [Scholarly] Article 1: "Title..." | Rank: 1 ← Match found!
   [Scholarly] ✗ Article 5: ... | Ranking: NOT FOUND  ← No match
   ```

---

## Quick Reference: Message Types

| Message Type     | From    | To         | Carries            | Response          |
| ---------------- | ------- | ---------- | ------------------ | ----------------- |
| `TOGGLE_CHANGED` | Popup   | Content    | `enabled: boolean` | None              |
| `LOAD_RANKINGS`  | Content | Background | Nothing            | `{success, data}` |

**How to add a new message:**

```typescript
// Sender (e.g., popup)
chrome.runtime.sendMessage(
  { type: "MY_NEW_MESSAGE", payload: { ... } },
  (response) => { console.log(response); }
);

// Receiver (e.g., background)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MY_NEW_MESSAGE") {
    // Do something
    sendResponse({ result: "done" });
  }
});
```

---

## The Complete Data Loop (Simplified)

```
USER CLICKS TOGGLE
  ↓
Popup.tsx: toggle state → storage + message
  ↓
Content Script receives TOGGLE_CHANGED
  ↓
Content Script: loadSJRData()
  ↓
csvParser.ts: sendMessage("LOAD_RANKINGS") to background
  ↓
Background: chrome.runtime.getURL() → fetch CSV → parseCSV()
  ↓
Background: sendResponse with 31,138 rankings
  ↓
Content Script: receives rankings, calls scrapeArticles()
  ↓
googleScholar.ts: querySelector(".gs_r") for each article
  ↓
Extract: title, journal, citations from Google Scholar DOM
  ↓
findRanking(journal, rankings) ← match logic
  ↓
If match: create badge element, appendChild() to DOM
  ↓
RESULT: Yellow badge shows on Google Scholar!
```

---

## Glossary

| Term                  | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| **Context**           | Different parts of extension with different capabilities   |
| **Content Script**    | Injected into webpage, can see/modify DOM                  |
| **Background Script** | Runs in browser, has full API access                       |
| **Popup**             | Extension popup UI                                         |
| **DOM**               | The HTML structure of a webpage                            |
| **querySelector**     | Find HTML element by CSS selector                          |
| **async/await**       | Way to handle slow operations (fetching, file reading)     |
| **Promise**           | Something that will give you a value later                 |
| **Message**           | Send data between extension contexts                       |
| **Chrome API**        | Functions provided by Chrome browser (storage, tabs, etc.) |
| **Caching**           | Storing data in memory so you don't reload it each time    |

---

**Next Time You Want to Add Something:**

1. Determine **where** the data comes from (popup, webpage, file, API)
2. Determine **where** it needs to go (storage, DOM, console, UI)
3. Determine **which context can access it** (background has file access, content has DOM access)
4. **Chain the message** if needed (popup → background → content)
5. **Test in console** with `[Scholarly]` logs

Good luck! 🚀
