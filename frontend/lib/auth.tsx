"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const AUTH_API = "/api/auth";
export const CANONICAL_SITE = "https://agenttrust.site";
// The login UI renders these providers in declaration order: Google → GitHub → Apple → Casdoor.
// Adding a provider requires updating `PROVIDERS` in `auth-bff/src/config.ts` and adding a
// CHECK-constraint migration; see `auth-bff/migrations/003_add_github_provider.sql` for the
// shape of the change.
export const OIDC_PROVIDER_ORDER = ["google", "github", "apple", "casdoor"] as const;
export type OidcProvider = (typeof OIDC_PROVIDER_ORDER)[number];
export type AuthIdentity = { provider: typeof OIDC_PROVIDER_ORDER[number]; email: string | null };
export type AuthAccount = { id: string; created_at: string; wallet: `0x${string}` | null; identities: AuthIdentity[] };
type CapabilityState = { configured: boolean };
export type AuthCapabilities = {
  wallet: { enabled: boolean; chainId: number; siwe: boolean };
  oidc: Record<OidcProvider, CapabilityState>;
};
export type AuthSession = { authenticated: false } | { authenticated: true; account: AuthAccount; csrfToken: string };
export type AuthState = "loading" | "authenticated" | "anonymous" | "unavailable";
type SignMessage = (message: string) => Promise<string>;
type AuthContextValue = {
  state: AuthState; account?: AuthAccount; csrfToken?: string; capabilities?: AuthCapabilities;
  refresh: () => Promise<void>;
  completeWalletLogin: (address: `0x${string}`, signMessage: SignMessage) => Promise<void>;
  linkWallet: (address: `0x${string}`, signMessage: SignMessage) => Promise<void>;
  startOidc: (provider: OidcProvider, returnTo: string) => Promise<string>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AUTH_API}${path}`, { credentials: "include", ...init });
  if (!response.ok) throw new Error(`auth_http_${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function sanitizeReturnTo(value: string | null | undefined, fallback = "/agents/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://return.invalid");
    return parsed.origin === "https://return.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch { return fallback; }
}
export function canonicalLoginUrl(returnTo: string): string {
  const url = new URL("/login/", CANONICAL_SITE);
  url.searchParams.set("returnTo", sanitizeReturnTo(returnTo));
  return url.toString();
}
function csrfHeaders(csrfToken: string) { return { ...JSON_HEADERS, "x-csrf-token": csrfToken }; }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [account, setAccount] = useState<AuthAccount>();
  const [csrfToken, setCsrfToken] = useState<string>();
  const [capabilities, setCapabilities] = useState<AuthCapabilities>();
  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const [caps, session] = await Promise.all([requestJson<AuthCapabilities>("/capabilities"), requestJson<AuthSession>("/session")]);
      setCapabilities(caps);
      setAccount(session.authenticated ? session.account : undefined);
      setCsrfToken(session.authenticated ? session.csrfToken : undefined);
      setState(session.authenticated ? "authenticated" : "anonymous");
    } catch { setCapabilities(undefined); setAccount(undefined); setCsrfToken(undefined); setState("unavailable"); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const completeWalletLogin = useCallback(async (address: `0x${string}`, signMessage: SignMessage) => {
    const challenge = await requestJson<{ nonce: string; message: string }>("/wallet/challenge", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ address }) });
    const signature = await signMessage(challenge.message);
    await requestJson("/wallet/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ nonce: challenge.nonce, message: challenge.message, signature }) });
    await refresh();
  }, [refresh]);
  const linkWallet = useCallback(async (address: `0x${string}`, signMessage: SignMessage) => {
    if (!csrfToken) throw new Error("csrf_token_missing");
    const headers = csrfHeaders(csrfToken);
    const challenge = await requestJson<{ nonce: string; message: string }>("/wallet/link/challenge", { method: "POST", headers, body: JSON.stringify({ address }) });
    const signature = await signMessage(challenge.message);
    const result = await requestJson<{ linked: true; account: AuthAccount }>("/wallet/link/verify", { method: "POST", headers, body: JSON.stringify({ nonce: challenge.nonce, message: challenge.message, signature }) });
    setAccount(result.account);
  }, [csrfToken]);
  const startOidc = useCallback(async (provider: OidcProvider, returnTo: string) => {
    const result = await requestJson<{ authorizationUrl: string }>(`/oidc/${provider}/start`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ returnTo: sanitizeReturnTo(returnTo) }) });
    const url = new URL(result.authorizationUrl);
    if (url.protocol !== "https:") throw new Error("invalid_authorization_url");
    return url.toString();
  }, []);
  const logout = useCallback(async () => {
    try {
      if (csrfToken) await requestJson("/logout", { method: "POST", headers: csrfHeaders(csrfToken), body: "{}" });
    } finally { setAccount(undefined); setCsrfToken(undefined); setState("anonymous"); }
  }, [csrfToken]);
  const value = useMemo(() => ({ state, account, csrfToken, capabilities, refresh, completeWalletLogin, linkWallet, startOidc, logout }), [state, account, csrfToken, capabilities, refresh, completeWalletLogin, linkWallet, startOidc, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
