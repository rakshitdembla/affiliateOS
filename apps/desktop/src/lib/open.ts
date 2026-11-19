import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./secrets";

/** Open an https link in the user's default browser (Tauri opener plugin; plain window.open outside Tauri). */
export async function openExternal(url: string): Promise<void> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("Invalid link"); }
  if (u.protocol !== "https:") throw new Error("Only https links can be opened");
  if (isTauri()) await openUrl(u.toString());
  else window.open(u.toString(), "_blank", "noopener,noreferrer");
}
