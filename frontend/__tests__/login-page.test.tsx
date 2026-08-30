import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startOidc: vi.fn(),
  completeWalletLogin: vi.fn(),
  account: { address: undefined as `0x${string}` | undefined, isConnected: false },
  capabilities: {
    wallet: { enabled: true, chainId: 31337, siwe: true },
    oidc: {
      google: { configured: true } as { configured: boolean },
      github: { configured: false } as { configured: boolean },
      apple: { configured: false } as { configured: boolean },
      casdoor: { configured: false } as { configured: boolean },
    },
  },
  state: "anonymous" as "anonymous" | "authenticated" | "unavailable" | "loading",
}));

vi.mock("@/lib/auth", () => ({
  canonicalLoginUrl: (returnTo: string) => `https://agenttrust.site/login?returnTo=${encodeURIComponent(returnTo)}`,
  sanitizeReturnTo: (value: string | null | undefined, fallback = "/agents/") => value && value.startsWith("/") ? value : fallback,
  useAuth: () => ({ state: mocks.state, capabilities: mocks.capabilities, completeWalletLogin: mocks.completeWalletLogin, startOidc: mocks.startOidc }),
  OIDC_PROVIDER_ORDER: ["google", "github", "apple", "casdoor"],
  CANONICAL_SITE: "https://agenttrust.site",
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnect: () => ({ connectAsync: vi.fn(), isPending: false }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));

vi.mock("wagmi/connectors", () => ({
  injected: () => ({}),
}));

// Minimal stub for the language switch to avoid pulling in the full LocaleProvider in tests.
vi.mock("@/app/components/language-switch", () => ({
  LanguageSwitch: () => <button data-testid="language-switch-stub">EN</button>,
}));

vi.mock("@/lib/locale", () => ({
  useLocale: () => ({ locale: "en", dictionary: {
    common: { close: "Close" },
    auth: {
      login: "Sign in", logout: "Sign out", status: "Authentication status", signedIn: "Signed in",
      checking: "Checking session…", redirectingCanonical: "Redirecting…",
      accessEyebrow: "Secure workspace access",
      title: "Sign in to AgentTrust", subtitle: "Authentication protects the workspace session.",
      benefitSession: "Server session", benefitWallet: "SIWE", benefitSeparate: "Stay distinct",
      loginOptions: "Sign-in options", recommended: "Recommended",
      walletTitle: "Wallet account", walletDescription: "Wallet description",
      signing: "Waiting…", signWallet: "Sign with connected wallet", connectAndSign: "Connect wallet and sign in",
      walletMissing: "No wallet", loginFailed: "Sign-in failed.", continueCanonical: "Continue on agenttrust.site",
      configuring: "Configuring", availableSoon: "Available soon",
      strongIdentityTitle: "Strong identity registration",
      strongIdentityPlaceholder: "No real-name verification currently offered.", planned: "Planned",
      labs: "Labs", worldIdLabs: "World ID is an experimental Proof-of-Humanity signal.",
      continueWith: "Continue", redirecting: "Redirecting…",
      walletUnavailable: "Wallet SIWE login not available.",
      walletGate: "Wallet binding", walletLinkTitle: "Bind a transaction wallet",
      walletLinkBody: "This social account has no wallet binding.", walletMismatchTitle: "Mismatch",
      walletMismatchBody: "Disconnected wallets must be re-bound.",
      boundWallet: "Bound wallet", connectedWallet: "Connected wallet",
      linkWallet: "Bind this wallet", matchWallet: "Match this wallet", walletLinkFailed: "Binding failed.",
    },
    account: { openMenu: "Account settings", closeMenu: "Close account settings", title: "Account",
      profile: "Profile", profileDesc: "Profile", transactions: "Transactions", transactionsDesc: "Activity",
      deregister: "Close identity", deregisterDesc: "Deregister", switchAccount: "Switch account", switchAccountDesc: "Switch",
      disconnect: "Disconnect", disconnectDesc: "Sign out", nickname: "Nickname", nicknamePlaceholder: "Name",
      nicknameHint: "Hint", avatar: "Photo", avatarUpload: "Choose photo", avatarRemove: "Remove photo", avatarHint: "Hint",
      avatarTooLarge: "Too large", avatarInvalid: "Invalid", copyAddress: "Copy", addressCopied: "Copied",
      localOnly: "Local only", deregisterTitle: "Close", deregisterWarning: "Warning",
      deregisterAction: "Deregister", deregistering: "Closing…", deregisterDone: "Closed.",
      withdrawAction: "Reclaim", withdrawing: "Reclaiming…", withdrawDone: "Reclaimed.",
      deregisterFlowDone: "Done", deregisterRequiresIdentity: "Required",
      deregisterBlocked: "Blocked: {reason}", txEmpty: "No transactions", txEmptyHint: "Hint",
      txClear: "Clear", txPending: "Pending", txSuccess: "Confirmed", txFailed: "Failed", txView: "View",
      txNow: "Just now", txMinutes: "{count}m", txHours: "{count}h", txDays: "{count}d",
      networkSection: "Wallet", switchAccountsHint: "Recent accounts" },
    walletPicker: { title: "Connect", subtitle: "Pick", current: "Connected", detected: "Detected", notDetected: "Not detected",
      browserWallet: "Browser", browserWalletDesc: "Use injected", install: "Install", connecting: "Connecting…",
      connectingTo: "Connecting to {name}", failure: "Could not connect to {name}. {reason}",
      rejected: "The connection request was rejected in {name}.", noWallets: "No browser wallet detected.",
      discoverHint: "Wallets that support EIP-6963 are detected.", switchTitle: "Switch wallet",
      switchSubtitle: "You are connected with {name}", disconnect: "Disconnect", keepConnected: "Stay connected",
      previousAttemptInterrupted: "Your last attempt to connect to {name} was interrupted.",
      privacy: "Privacy" },
  } }),
  formatMessage: (template: string, values: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`)),
}));

import LoginPage from "@/app/login/page";

beforeEach(() => {
  mocks.state = "anonymous";
  mocks.startOidc.mockReset();
  mocks.completeWalletLogin.mockReset();
  mocks.account.address = undefined;
  mocks.account.isConnected = false;
  mocks.capabilities = { wallet: { enabled: true, chainId: 31337, siwe: true }, oidc: { google: { configured: true }, github: { configured: false }, apple: { configured: false }, casdoor: { configured: false } } };
});
afterEach(() => delete (window as unknown as Record<string, unknown>).location);

describe("LoginPage intro + sign-in stack", () => {
  it("renders the intro title, lead, and three benefit bullets on the left", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { level: 1, name: /sign in to agenttrust/i })).toBeInTheDocument();
    expect(screen.getByText(/authentication protects the workspace session/i)).toBeInTheDocument();
    expect(screen.getByText(/server session/i)).toBeInTheDocument();
    expect(screen.getByText(/siwe/i)).toBeInTheDocument();
    expect(screen.getByText(/stay distinct/i)).toBeInTheDocument();
  });

  it("renders the three social provider buttons in canonical order with configuring state for the unconfigured ones", () => {
    render(<LoginPage />);
    const googleButton = screen.getByRole("button", { name: "Continue Google" });
    const githubButton = screen.getByRole("button", { name: "Configuring GitHub" });
    const appleButton = screen.getByRole("button", { name: "Configuring Apple" });
    expect(googleButton).not.toBeDisabled();
    expect(githubButton).toBeDisabled();
    expect(appleButton).toBeDisabled();
    // DOM order: google → github → apple
    const buttons = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.findIndex((t) => t.includes("Google"))).toBeLessThan(buttons.findIndex((t) => t.includes("GitHub")));
    expect(buttons.findIndex((t) => t.includes("GitHub"))).toBeLessThan(buttons.findIndex((t) => t.includes("Apple")));
  });

  it("starts OIDC for the configured provider when its button is clicked", async () => {
    mocks.startOidc.mockResolvedValue("https://accounts.example/authorize");
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...(window.location as object), assign: assignSpy }, configurable: true });
    render(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: /Continue Google/i }));
    expect(mocks.startOidc).toHaveBeenCalledWith("google", "/agents/");
    expect(assignSpy).toHaveBeenCalledWith("https://accounts.example/authorize");
  });
});
