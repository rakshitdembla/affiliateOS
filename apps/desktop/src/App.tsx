import { HashRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import { ComingSoon } from "./pages/ComingSoon";

const queryClient = new QueryClient();

const planned = [
  { path: "products", title: "Products", phase: 2, description: "Paste an affiliate URL to extract title, image and price from Amazon, Myntra and Meesho." },
  { path: "collections", title: "Collections", phase: 3, description: "Build, order and publish shoppable collection pages." },
  { path: "instagram", title: "Instagram", phase: 4, description: "Connect your professional account through official Meta OAuth and webhooks." },
  { path: "automations", title: "Automations", phase: 5, description: "Link reels and trigger keywords to collections." },
  { path: "queue", title: "Message Queue", phase: 5, description: "Durable DM queue processed locally with retries and an audit trail." },
  { path: "analytics", title: "Analytics", phase: 6, description: "Click, comment and message analytics with CSV export." },
  { path: "logs", title: "Logs", phase: 5, description: "Filterable structured logs for every system operation." },
];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            {planned.map((p) => <Route key={p.path} path={p.path} element={<ComingSoon {...p} />} />)}
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<ComingSoon title="Not found" phase={0} description="This page does not exist." />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
