// utility functions for interacting with chrome.storage

/**
 * Persist the enabled state of the Google Scholar scraper.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export function setGoogleScholarEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ googleScholarEnabled: enabled }, () => {
        resolve();
      });
    } else {
      // fallback to localStorage if chrome.storage isn't available (e.g. during testing)
      try {
        localStorage.setItem("googleScholarEnabled", JSON.stringify(enabled));
      } catch (e) {}
      resolve();
    }
  });
}

/**
 * Retrieve the saved state of the Google Scholar scraper.
 * @returns {Promise<boolean>}
 */
export function getGoogleScholarEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["googleScholarEnabled"], (result) => {
        resolve(Boolean(result.googleScholarEnabled));
      });
    } else {
      try {
        const val = JSON.parse(localStorage.getItem("googleScholarEnabled") ?? "false");
        resolve(Boolean(val));
      } catch (e) {
        resolve(false);
      }
    }
  });
}
