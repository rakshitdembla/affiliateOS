import { useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { QueueEngine } from "./queueEngine";

/** The app-wide engine instance (one per install; its worker id is stored locally). */
export const engine = new QueueEngine({
  api: {
    sync: (b) => api.queueSync(b),
    claim: (w, n) => api.queueClaim(w, n),
    release: (w) => api.queueRelease(w),
    send: (id, w, p) => api.queueSend(id, w, p),
    log: (e) => api.engineLog(e),
  },
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
});

export const useEngine = () => useSyncExternalStore(engine.subscribe, engine.getSnapshot);
