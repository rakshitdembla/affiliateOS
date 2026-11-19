export const API = "http://localhost:8787";
export const E2E_TOKEN = "e2e-local-token-not-a-secret-0001";
/** Throwaway Instagram config for the local E2E Worker only (no real Meta app involved). */
export const E2E_IG = {
  PUBLIC_BASE_URL: API,
  IG_APP_ID: "1234567890",
  IG_APP_SECRET: "e2e-instagram-app-secret",
  IG_WEBHOOK_VERIFY_TOKEN: "e2e-verify-token",
  TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
  IG_GRAPH_BASE: "http://localhost:8799",
} as const;
export const MOCK_META = "http://localhost:8799";
