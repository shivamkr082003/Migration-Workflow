import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Callout, Spinner } from "./components/ui";
import { WorkbenchProvider } from "./lib/workbench";
import { DryRunPage } from "./pages/DryRunPage";
import { ExecutePage } from "./pages/ExecutePage";
import { HistoryPage } from "./pages/HistoryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PlanPage } from "./pages/PlanPage";

export function App() {
  return (
    <WorkbenchProvider
      fallback={({ error }) =>
        error ? (
          <div className="mx-auto mt-24 max-w-md">
            <Callout tone="error" title="Cannot load the workbench">
              {error instanceof Error ? error.message : String(error)}
            </Callout>
          </div>
        ) : (
          <Spinner label="Loading workbench…" />
        )
      }
    >
      <Layout>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/dry-run" element={<DryRunPage />} />
          <Route path="/execute" element={<ExecutePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </WorkbenchProvider>
  );
}
