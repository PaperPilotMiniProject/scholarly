import { defineConfig } from "wxt";
import path from "path";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    permissions: ["tabs", "scripting", "storage"],
    host_permissions: [
      "*://*.google.com/*",
      "*://api.crossref.org/*",
      "*://api.elsevier.com/*",
    ],
  },
  vite: () => ({
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  }),
});
