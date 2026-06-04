import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { findMissingEnv, renderStartupError } from "./lib/env-validation";
import { initRendererLogging } from "./lib/renderer-logging";

initRendererLogging();

const rootEl = document.getElementById("root")!;
const missingEnv = findMissingEnv();
if (missingEnv.length > 0) {
  // Build-time vite-plugin-validate-env should have caught this, but if a
  // CI run somehow embeds empty strings, fail loudly with a readable error
  // rather than mounting <App /> and producing silent backend-call failures.
  console.error("[env-validation] Missing required env vars:", missingEnv);
  renderStartupError(missingEnv, rootEl);
} else {
  createRoot(rootEl).render(<App />);
}
