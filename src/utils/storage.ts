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
        // Default to enabled if the value has never been set.
        const enabled = result.googleScholarEnabled;
        resolve(enabled === undefined ? true : Boolean(enabled));
      });
    } else {
      try {
        const stored = localStorage.getItem("googleScholarEnabled");
        if (stored === null) {
          resolve(true);
          return;
        }
        const val = JSON.parse(stored);
        resolve(Boolean(val));
      } catch (e) {
        resolve(true);
      }
    }
  });
}
