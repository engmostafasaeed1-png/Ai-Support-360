import { assertSingleReact } from "./lib/reactSingletonGuard";
assertSingleReact();

import { createRoot } from "react-dom/client";
import ErrorBoundary from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./i18n/config";
import "./index.css";
import { installCspViolationLogger } from "./lib/diagnostics";
import { initSentry } from "./lib/sentry";
import { installGlobalErrorReporting } from "./lib/errorReporter";
import { installStaleChunkReload } from "./lib/staleChunkReload";

initSentry();
installCspViolationLogger();
installGlobalErrorReporting();
installStaleChunkReload();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

