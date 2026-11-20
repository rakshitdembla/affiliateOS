import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./secrets";

/** Save a CSV: into ~/Downloads via the native command in the app (revealed in Finder); a normal download in a browser. */
export async function saveCsv(fileName: string, csv: string): Promise<string> {
  if (isTauri()) return invoke<string>("save_export", { fileName, contents: csv });
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
