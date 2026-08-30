import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, canonicalLoginUrl, sanitizeReturnTo, useAuth, type AuthCapabilities } from "@/lib/auth";

const address = `0x${"12".repeat(20)}` as const;
const capabilities: AuthCapabilities = {
  wallet: { enabled: true, chainId: 31337, siwe: true },
  oidc: { google: { configured: true }, apple: { configured: false } },
};
const account = { id: "account-1", created_at: "2026-08-28T00:00:00.000Z", wallet: address, identities: [] };
function Wrapper({ children }: { children: React.ReactNode }) { return <AuthProvider>{children}</AuthProvider>; }
function response(value: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
afterEach(() => vi.unstubAllGlobals());

describe("authentication redirects", () => {
  it("keeps same-site paths and rejects external returnTo values", () => {
    expect(sanitizeReturnTo("/disputes/?tradeId=7")).toBe("/disputes/?tradeId=7");
    for (const value of ["https://evil.example/", "//evil.example/", "\\evil.example", "javascript:alert(1)", ""]) expect(sanitizeReturnTo(value)).toBe("/agents/");
  });
  it("builds the unavailable-API fallback only on the canonical host", () => {
    const url = new URL(canonicalLoginUrl("/trade/?id=2"));
    expect(url.origin).toBe("https://agenttrust.site");
    expect(url.searchParams.get("returnTo")).toBe("/trade/?id=2");
  });
});

describe("Auth BFF client contract", () => {
  it("uses the real wallet login endpoints and strict verify body", async () => {
    let authenticated = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://app.test").pathname;
      if (path.endsWith("/capabilities")) return response(capabilities);
      if (path.endsWith("/session")) return response(authenticated ? { authenticated: true, account, csrfToken: "csrf-1" } : { authenticated: false });
      if (path.endsWith("/wallet/challenge")) { expect(JSON.parse(String(init?.body))).toEqual({ address }); return response({ nonce: "nonce-1234567890", message: "sign-me" }); }
      if (path.endsWith("/wallet/verify")) {
        expect(JSON.parse(String(init?.body))).toEqual({ nonce: "nonce-1234567890", message: "sign-me", signature: "0xsigned" });
        authenticated = true; return response({ authenticated: true, account });
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.state).toBe("anonymous"));
    await act(() => result.current.completeWalletLogin(address, async () => "0xsigned"));
    expect(result.current.state).toBe("authenticated");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/siwe/nonce"))).toBe(false);
  });

  it("sends CSRF for wallet linking/logout and starts configured OIDC", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://app.test").pathname;
      if (path.endsWith("/capabilities")) return response(capabilities);
      if (path.endsWith("/session")) return response({ authenticated: true, account, csrfToken: "csrf-1" });
      if (path.endsWith("/wallet/link/challenge")) { expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-1"); return response({ nonce: "link-nonce-123456", message: "link-me" }); }
      if (path.endsWith("/wallet/link/verify")) { expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-1"); expect(JSON.parse(String(init?.body))).toEqual({ nonce: "link-nonce-123456", message: "link-me", signature: "0xlinked" }); return response({ linked: true, account }); }
      if (path.endsWith("/oidc/google/start")) { expect(JSON.parse(String(init?.body))).toEqual({ returnTo: "/trade/" }); return response({ authorizationUrl: "https://accounts.example/authorize" }); }
      if (path.endsWith("/logout")) { expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-1"); return response(undefined, 204); }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.state).toBe("authenticated"));
    await act(() => result.current.linkWallet(address, async () => "0xlinked"));
    await expect(result.current.startOidc("google", "/trade/")).resolves.toBe("https://accounts.example/authorize");
    await act(() => result.current.logout());
    expect(result.current.state).toBe("anonymous");
  });
});
