import { useState, useEffect } from "react";
import {
  getGoogleScholarEnabled,
  setGoogleScholarEnabled,
} from "../../src/utils/storage";
import "./App.css";

function App() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // read initial value from storage when popup opens
    getGoogleScholarEnabled().then((val) => {
      setEnabled(val);
      setLoading(false);
    });
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
            chrome.tabs.sendMessage(tab.id, {
              type: "TOGGLE_CHANGED",
              enabled: newVal,
            }).catch((error) => {
              // Tab might not have content script loaded, that's ok
              console.log("Could not send message to tab:", error);
            });
          }
        });
      });
    }
  };

  return (
    <div className="app-container">
      <h1>Scholarly</h1>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={toggle} />
          <span className="slider" />
          <span className="label-text">Enable Google Scholar scraping</span>
        </label>
      )}
    </div>
  );
}

export default App;
