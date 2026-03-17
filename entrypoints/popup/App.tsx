import { useState, useEffect } from "react";
import {
  getGoogleScholarEnabled,
  setGoogleScholarEnabled,
} from "../../src/utils/storage";
import {
  getConfig,
  setConfig,
  validateScopusCredentials,
} from "../../src/utils/config";
import "./App.css";

function App() {
  const [enabled, setEnabled] = useState(false);
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
    Promise.all([getGoogleScholarEnabled(), getConfig()]).then(
      ([scholarEnabled, config]: any) => {
        setEnabled(scholarEnabled);
        setScopusApiKey(config.scopusApiKey || "");
        setScopusInstToken(config.scopusInstToken || "");
        setUseScopusApi(config.useScopusApi !== false);
        setLoading(false);
      },
    );
  }, []);

  const toggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.checked;
    setEnabled(newVal);
    setGoogleScholarEnabled(newVal); // persist

    // Notify all Google Scholar tabs about the toggle change
    if (chrome && chrome.tabs) {
      chrome.tabs.query({ url: "*://*.google.com/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                type: "TOGGLE_CHANGED",
                enabled: newVal,
              })
              .catch((error) => {
                // Tab might not have content script loaded, that's ok
                console.log("Could not send message to tab:", error);
              });
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

    // Validate credentials
    const result = await validateScopusCredentials(
      scopusApiKey,
      scopusInstToken,
    );

    if (result.valid) {
      // Save to storage
      await setConfig({
        scopusApiKey: scopusApiKey.trim(),
        scopusInstToken: scopusInstToken.trim(),
        useScopusApi: useScopusApi,
      });
      setValidationMessage("✓ Settings saved successfully!");
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
  };

  return (
    <div className="app-container">
      <h1>📊 Scholarly</h1>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="settings-section">
            <label className="switch">
              <input type="checkbox" checked={enabled} onChange={toggle} />
              <span className="slider" />
              <span className="label-text">Enable Google Scholar</span>
            </label>
          </div>

          <button
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
          >
            {showSettings ? "Hide Settings ▲" : "Show Settings ▼"}
          </button>

          {showSettings && (
            <div className="scopus-settings">
              <h3>Scopus API Configuration</h3>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={useScopusApi}
                  onChange={handleToggleScopusApi}
                />
                <span className="slider" />
                <span className="label-text">
                  Use Scopus API (real-time rankings)
                </span>
              </label>

              {useScopusApi && (
                <>
                  <div className="form-group">
                    <label>Scopus API Key</label>
                    <input
                      type="password"
                      value={scopusApiKey}
                      onChange={(e) => setScopusApiKey(e.target.value)}
                      placeholder="Enter your Scopus API key"
                      className="input-field"
                    />
                  </div>

                  <div className="form-group">
                    <label>Institution Token (Optional)</label>
                    <input
                      type="password"
                      value={scopusInstToken}
                      onChange={(e) => setScopusInstToken(e.target.value)}
                      placeholder="Enter institution token if available"
                      className="input-field"
                    />
                  </div>

                  <div className="form-group">
                    <button
                      onClick={handleSaveScpusSettings}
                      disabled={validating}
                      className="save-btn"
                    >
                      {validating ? "Validating..." : "Save & Validate"}
                    </button>
                  </div>

                  {validationMessage && (
                    <div className={`validation-message ${validationStatus}`}>
                      {validationMessage}
                    </div>
                  )}

                  <p className="help-text">
                    Get your API key from:{" "}
                    <a
                      href="https://dev.elsevier.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Elsevier Developer Portal
                    </a>
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
