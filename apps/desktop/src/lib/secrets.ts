import { invoke } from "@tauri-apps/api/core";

/** True when running inside the Tauri shell (macOS Keychain available). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SERVICE_KEY = "admin_api_token";

export async function getToken(): Promise<string | null> {
  if (!isTauri()) return null;
  return (await invoke<string | null>("secret_get", { key: SERVICE_KEY })) ?? null;
}
export async function setToken(value: string): Promise<void> {
  if (!isTauri()) throw new Error("Secure storage is only available in the desktop app");
  await invoke("secret_set", { key: SERVICE_KEY, value });
}
export async function clearToken(): Promise<void> {
  if (isTauri()) await invoke("secret_delete", { key: SERVICE_KEY });
}
