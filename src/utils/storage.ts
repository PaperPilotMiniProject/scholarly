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
 * Persist the enabled state of the Scopus scraper.
 */
export function setScopusEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ scopusEnabled: enabled }, () => {
        resolve();
      });
    } else {
      try {
        localStorage.setItem("scopusEnabled", JSON.stringify(enabled));
      } catch (e) {}
      resolve();
    }
  });
}

/**
 * Retrieve the saved state of the Scopus scraper.
 */
export function getScopusEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["scopusEnabled"], (result) => {
        const enabled = result.scopusEnabled;
        resolve(enabled === undefined ? true : Boolean(enabled));
      });
    } else {
      try {
        const stored = localStorage.getItem("scopusEnabled");
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

/**
 * Persist the enabled state of the ORCID scraper.
 */
export function setOrcidEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ orcidEnabled: enabled }, () => {
        resolve();
      });
    } else {
      try {
        localStorage.setItem("orcidEnabled", JSON.stringify(enabled));
      } catch (e) {}
      resolve();
    }
  });
}

/**
 * Retrieve the saved state of the ORCID scraper.
 */
export function getOrcidEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["orcidEnabled"], (result) => {
        const enabled = result.orcidEnabled;
        resolve(enabled === undefined ? true : Boolean(enabled));
      });
    } else {
      try {
        const stored = localStorage.getItem("orcidEnabled");
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
