import type { DmStatus } from "@affiliateos/shared";
import type { EngineState } from "../engine/queueEngine";

export const STATUS_TONE: Record<DmStatus, "ok" | "warn" | "bad" | "neutral"> = { pending: "neutral", processing: "warn", sent: "ok", failed: "bad", skipped: "neutral", uncertain: "warn" };
export const ENGINE_LABEL: Record<EngineState, string> = { stopped: "Stopped", idle: "Running — waiting for work", sending: "Sending", paused: "Paused", blocked: "Waiting — needs attention", offline: "Offline", cooldown: "Cooling down" };
export const ENGINE_TONE: Record<EngineState, "ok" | "warn" | "bad" | "neutral"> = { stopped: "neutral", idle: "ok", sending: "ok", paused: "neutral", blocked: "warn", offline: "bad", cooldown: "warn" };
