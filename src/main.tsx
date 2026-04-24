import { createRoot } from "react-dom/client";
import ErrorBoundary from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./i18n/config";
import "./index.css";
import { installCspViolationLogger } from "./lib/diagnostics";

installCspViolationLogger();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
