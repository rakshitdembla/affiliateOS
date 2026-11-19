import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import { Products } from "./pages/Products";
import { Collections } from "./pages/Collections";
import { Instagram } from "./pages/Instagram";
import { Automations } from "./pages/Automations";
import { Queue } from "./pages/Queue";
import { Logs } from "./pages/Logs";
import { engine } from "./engine";
import { getToken } from "./lib/secrets";
import { ComingSoon } from "./pages/ComingSoon";

const queryClient = new QueryClient();

const planned = [
  { path: "analytics", title: "Analytics", phase: 6, description: "Click, comment and message analytics with CSV export." },
];

export default function App() {
  // Start processing pending replies as soon as the app opens (unless paused or no backend token yet).
  useEffect(() => {
    getToken().then((t) => { if (t) engine.start(); }).catch(() => undefined);
    const stop = () => { void engine.stop(); };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            {planned.map((p) => <Route key={p.path} path={p.path} element={<ComingSoon {...p} />} />)}
            <Route path="products" element={<Products />} />
            <Route path="collections" element={<Collections />} />
            <Route path="instagram" element={<Instagram />} />
            <Route path="automations" element={<Automations />} />
            <Route path="queue" element={<Queue />} />
            <Route path="logs" element={<Logs />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<ComingSoon title="Not found" phase={0} description="This page does not exist." />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
