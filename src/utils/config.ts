/**
 * Scholarly Extension - Configuration Module
 * Handles Scopus API credentials storage and retrieval
 */

/**
 * Retrieves all configuration from chrome storage
 */
export async function getConfig() {
  return new Promise((resolve) => {
    const defaults = {
      scopusApiKey: "",
      scopusInstToken: "",
      useScopusApi: true,
    };
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      try {
        const storedKey = localStorage.getItem("scopusApiKey") || "";
        const storedToken = localStorage.getItem("scopusInstToken") || "";
        const storedUseApi = localStorage.getItem("useScopusApi");
        
        resolve({
          scopusApiKey: storedKey,
          scopusInstToken: storedToken,
          useScopusApi: storedUseApi !== null ? JSON.parse(storedUseApi) : true,
        });
      } catch (e) {
        resolve(defaults);
      }
      return;
    }
    chrome.storage.local.get(
      ["scopusApiKey", "scopusInstToken", "useScopusApi"],
      (items) => {
        resolve({
          scopusApiKey: items.scopusApiKey || "",
          scopusInstToken: items.scopusInstToken || "",
          useScopusApi: items.useScopusApi !== false,
        });
      },
    );
  });
}

/**
 * Saves configuration to chrome storage
 */
export async function setConfig(config: {
  scopusApiKey?: string;
  scopusInstToken?: string;
  useScopusApi?: boolean;
}) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      try {
        if (config.scopusApiKey !== undefined) localStorage.setItem("scopusApiKey", config.scopusApiKey);
        if (config.scopusInstToken !== undefined) localStorage.setItem("scopusInstToken", config.scopusInstToken);
        if (config.useScopusApi !== undefined) localStorage.setItem("useScopusApi", JSON.stringify(config.useScopusApi));
      } catch (e) {}
      resolve(true);
      return;
    }
    chrome.storage.local.set(config, () => {
      console.log("[Scholarly Config] Settings saved:", config);
      resolve(true);
    });
  });
}

/**
 * Validates Scopus API credentials
 */
export async function validateScopusCredentials(
  apiKey: string,
  instToken?: string,
): Promise<{ valid: boolean; message: string }> {
  if (!apiKey) {
    return {
      valid: false,
      message: "Scopus API key is required",
    };
  }

  try {
    // Test with a simple API call
    const params = new URLSearchParams({
      apikey: apiKey,
      view: "ENHANCED",
    });

    if (instToken) {
      params.append("insttoken", instToken);
    }

    // Use a known ISSN to test
    const testIssn = "0167739X"; // Science (well-known journal)
    const url = `https://api.elsevier.com/content/serial/title/issn/${testIssn}?${params.toString()}`;

    const response = await fetch(url);

    if (response.ok) {
      return {
        valid: true,
        message: "API credentials are valid",
      };
    } else if (response.status === 401) {
      return {
        valid: false,
        message: "Invalid API key. Please check your credentials.",
      };
    } else if (response.status === 403) {
      return {
        valid: false,
        message: "Access denied. Check your institution token.",
      };
    } else {
      return {
        valid: false,
        message: `API error: ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      message: `Connection error: ${(error as Error).message}`,
    };
  }
}

/**
 * Clears all stored configuration
 */
export async function clearConfig() {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      try {
        localStorage.removeItem("scopusApiKey");
        localStorage.removeItem("scopusInstToken");
      } catch (e) {}
      resolve(true);
      return;
    }
    chrome.storage.local.remove(["scopusApiKey", "scopusInstToken"], () => {
      console.log("[Scholarly Config] Configuration cleared");
      resolve(true);
    });
  });
}
