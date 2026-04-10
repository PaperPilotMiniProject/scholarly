import { useState, useEffect } from "react";
import {
  getGoogleScholarEnabled,
  getScopusEnabled,
  getOrcidEnabled,
  setGoogleScholarEnabled,
  setScopusEnabled,
  setOrcidEnabled,
} from "../../src/utils/storage";
import {
  getConfig,
  setConfig,
  validateScopusCredentials,
} from "../../src/utils/config";
import "./App.css";

function App() {
  const [enabled, setEnabled] = useState(true);
  const [scopusEnabled, setScopusEnabledState] = useState(true);
  const [orcidEnabled, setOrcidEnabledState] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [scopusApiKey, setScopusApiKey] = useState("");
  const [scopusInstToken, setScopusInstToken] = useState("");
  const [useScopusApi, setUseScopusApi] = useState(true);
  const [validating, setValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [validationStatus, setValidationStatus] = useState<
    "" | "success" | "error"
  >("");

  useEffect(() => {
    // read initial values from storage when popup opens
    Promise.all([
      getGoogleScholarEnabled(), 
      getScopusEnabled(), 
      getOrcidEnabled(),
      getConfig()
    ])
      .then(([scholarEnabled, scopusEnabledVal, orcidEnabledVal, config]: any) => {
        setEnabled(scholarEnabled);
        setScopusEnabledState(scopusEnabledVal);
        setOrcidEnabledState(orcidEnabledVal);
        setScopusApiKey(config.scopusApiKey || "");
        setScopusInstToken(config.scopusInstToken || "");
        setUseScopusApi(config.useScopusApi !== false);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[Scholarly Popup] Failed to load settings", err);
        setLoading(false);
      });
  }, []);

  // Workaround for Chrome extension popup not shrinking
  useEffect(() => {
    if (!showSettings) {
      const timer = setTimeout(() => {
        document.body.style.display = 'none';
        document.body.clientHeight; // trigger reflow
        document.body.style.display = 'block';
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showSettings]);

  const toggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setEnabled(newVal);
    setGoogleScholarEnabled(newVal);

    if (chrome && chrome.tabs) {
      chrome.tabs.query({ url: "*://*.google.com/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_CHANGED", enabled: newVal }).catch(() => {});
          }
        });
      });
    }
  };

  const toggleScopus = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setScopusEnabledState(newVal);
    setScopusEnabled(newVal);

    if (chrome && chrome.tabs) {
      chrome.tabs.query({ url: "*://*.scopus.com/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SCOPUS_CHANGED", enabled: newVal }).catch(() => {});
          }
        });
      });
    }
  };

  const toggleOrcid = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setOrcidEnabledState(newVal);
    setOrcidEnabled(newVal);

    if (chrome && chrome.tabs) {
      chrome.tabs.query({ url: "*://*.orcid.org/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ORCID_CHANGED", enabled: newVal }).catch(() => {});
          }
        });
      });
    }
  };

  const handleSaveScpusSettings = async () => {
    setValidating(true);
    setValidationMessage("");
    setValidationStatus("");

    if (!scopusApiKey.trim()) {
      setValidationMessage("API key cannot be empty");
      setValidationStatus("error");
      setValidating(false);
      return;
    }

    const result = await validateScopusCredentials(scopusApiKey, scopusInstToken);

    if (result.valid) {
      await setConfig({
        scopusApiKey: scopusApiKey.trim(),
        scopusInstToken: scopusInstToken.trim(),
        useScopusApi: useScopusApi,
      });
      setValidationMessage("Settings saved successfully!");
      setValidationStatus("success");
    } else {
      setValidationMessage(result.message);
      setValidationStatus("error");
    }
    setValidating(false);
  };

  const handleToggleScopusApi = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setUseScopusApi(newVal);
    setConfig({ useScopusApi: newVal });

    if (chrome && chrome.tabs) {
      const urls = ["*://*.google.com/*", "*://*.scopus.com/*", "*://*.orcid.org/*"];
      chrome.tabs.query({ url: urls }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) chrome.tabs.reload(tab.id);
        });
      });
    }
  };

  const handleDeleteKey = () => {
    setScopusApiKey("");
    setScopusInstToken("");
    setConfig({ scopusApiKey: "", scopusInstToken: "" });
    setValidationMessage("API credentials cleared");
    setValidationStatus("success");
  };

  return (
    <div className="app-container">
      <header>
        <div className="brand-icon">S</div>
        <h1>Scholarly</h1>
      </header>

      {loading ? (
        <main style={{ textAlign: "center", padding: "2rem" }}>
          <div className="loading-spinner"></div>
          <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading settings...</p>
        </main>
      ) : (
        <main>
          <div className="card">
            <div className="settings-group">
              <label className="switch">
                <span className="label-text">Google Scholar</span>
                <input type="checkbox" checked={enabled} onChange={toggle} />
                <span className="slider" />
              </label>

              <label className="switch">
                <span className="label-text">Scopus Integration</span>
                <input type="checkbox" checked={scopusEnabled} onChange={toggleScopus} />
                <span className="slider" />
              </label>

              <label className="switch">
                <span className="label-text">ORCID Integration</span>
                <input type="checkbox" checked={orcidEnabled} onChange={toggleOrcid} />
                <span className="slider" />
              </label>
            </div>

            <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
              Advanced Configuration {showSettings ? "↑" : "↓"}
            </button>
          </div>

          {showSettings && (
            <section className="scopus-settings">
              <h3>Scopus API Configuration</h3>

              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label className="switch" style={{ padding: 0 }}>
                  <span className="label-text" style={{ fontSize: "13px", fontWeight: 600 }}>Enable Scopus API</span>
                  <input type="checkbox" checked={useScopusApi} onChange={handleToggleScopusApi} />
                  <span className="slider" />
                </label>
                <p className="help-text" style={{ marginTop: "4px" }}>
                  Disabling API will use local SJR data.
                </p>
              </div>

              {useScopusApi && (
                <>
                  <div className="form-group">
                    <label>Scopus API Key</label>
                    <input
                      type="password"
                      value={scopusApiKey}
                      onChange={(e) => setScopusApiKey(e.target.value)}
                      placeholder="Enter your API key"
                      className="input-field"
                    />
                  </div>

                  <div className="form-group">
                    <label>Institution Token</label>
                    <input
                      type="password"
                      value={scopusInstToken}
                      onChange={(e) => setScopusInstToken(e.target.value)}
                      placeholder="Enter insttoken"
                      className="input-field"
                    />
                  </div>

                  <div className="button-row">
                    <button onClick={handleSaveScpusSettings} disabled={validating} className="save-btn">
                      {validating ? "Validating..." : "Save & Verify"}
                    </button>
                    <button onClick={handleDeleteKey} className="delete-btn" title="Clear API Credentials">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>

                  <div className="help-text" style={{ marginTop: "12px", textAlign: "center" }}>
                    <a href="https://dev.elsevier.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px" }}>
                      Get Scopus API Key
                    </a>
                  </div>

                  {validationMessage && (
                    <div className={`validation-message ${validationStatus}`}>
                      {validationMessage}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </main>
      )}

      <footer>
        <div className="version">v1.1.0</div>
      </footer>
    </div>
  );
}

export default App;
