"use client";

import { useConnectors } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Connector, CreateConnectorFn } from "wagmi";

/**
 * 钱包目录。
 *
 * 解析顺序（越靠前越优先）：
 *   1. EIP-6963 已注册的 connector（wagmi 通过 mipd 自动发现，id === rdns）
 *   2. window.ethereum 上的 legacy provider 标记（isMetaMask / isRabby / …）
 *   3. 未检测到 → 展示安装入口
 *
 * 走 EIP-6963 的 connector 是 config 里已注册的实例，id 稳定，
 * wagmi 写入的 `recentConnectorId` 才能在刷新后自动重连。
 */

export type WalletId = "metamask" | "rabby" | "okx" | "coinbase" | "rainbow" | "browser";

export type WalletDefinition = {
  id: WalletId;
  name: string;
  /** EIP-6963 reverse-DNS identifier, used to match auto-discovered connectors. */
  rdns: string[];
  installUrl: string;
  /** Legacy `window.ethereum` provider flag, e.g. `isMetaMask`. */
  flag?: string;
  /** Legacy dedicated global, e.g. `window.okxwallet`. */
  windowKey?: string;
  accent: string;
  Icon: (props: { size?: number }) => React.ReactElement;
};

/** 简化几何化的钱包标识 —— 仅用于识别，不使用官方商标文件。 */
function MetaMaskMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#FFF3E6" />
      <path d="M23.6 6.5 18.1 10.6l1-2.6z" fill="#E2761B" />
      <path d="M8.4 6.5l5.5 4.2-1-2.6z" fill="#E2761B" />
      <path d="M21.4 19.4l-1.5 2.3 3.1.9.9-3.2z" fill="#E4761B" />
      <path d="M7.1 19.4l.9 3.2 3.1-.9-1.5-2.3z" fill="#E4761B" />
      <path d="M14.4 12.7l-1.5-2.3 5.5-3.9h-6.8l3.1 3.9z" fill="#F6851B" />
      <path d="M17.6 12.7l2.8-6.2h-6.8l5.5 3.9z" fill="#F6851B" />
      <path d="M12.9 22.2l3.1-1.5 3.1 1.5-1.1-3.6h-4z" fill="#C0AD9E" />
      <path d="M8.9 10.4l1.1 3.6 4-.2-1-4z" fill="#763D16" />
      <path d="M18 14l4 .2 1.1-3.8z" fill="#763D16" />
      <path d="M22.2 16.4l-.4 3 2.1 1.1.6-2.3z" fill="#F6851B" />
      <path d="M7.5 18.2l.6 2.3 2.1-1.1-.4-3z" fill="#F6851B" />
    </svg>
  );
}

function RabbyMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#7084FF" />
      <circle cx="16" cy="17.5" r="8.5" fill="#FFFFFF" />
      <path d="M7.5 14.5 5.2 8.4l5.6 2.2z" fill="#FFFFFF" />
      <path d="M24.5 14.5l2.3-6.1-5.6 2.2z" fill="#FFFFFF" />
      <circle cx="12.6" cy="16.4" r="1.5" fill="#2C2F3A" />
      <circle cx="19.4" cy="16.4" r="1.5" fill="#2C2F3A" />
      <path d="M13.6 20.4h4.8a2.4 2.4 0 0 1-4.8 0z" fill="#2C2F3A" />
    </svg>
  );
}

function OkxMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#141414" />
      <path d="M11.4 7h3.1v3.1H11.4zM17.5 7h3.1v3.1h-3.1zM14.45 10.05h3.1v3.1h-3.1zM11.4 13.1h3.1v3.1h-3.1zM17.5 13.1h3.1v3.1h-3.1zM11.4 19.2h3.1v3.1h-3.1zM17.5 19.2h3.1v3.1h-3.1zM14.45 16.15h3.1v3.1h-3.1zM14.45 22.25h3.1v3.1h-3.1z" fill="#FFFFFF" />
    </svg>
  );
}

function CoinbaseMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={32} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0052FF" />
      <circle cx="16" cy="16" r="10.5" fill="#FFFFFF" />
      <rect x="11.5" y="11.5" width="9" height="9" rx="2.2" fill="#0052FF" />
    </svg>
  );
}

function RainbowMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="at-rainbow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#7A5AF8" />
          <stop offset="45%" stopColor="#FF4E8B" />
          <stop offset="100%" stopColor="#FFB14D" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#at-rainbow)" />
      <path d="M6 23c0-5.5 4.5-10 10-10s10 4.5 10 10" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M11 23c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.75" />
    </svg>
  );
}

function BrowserMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.12" />
      <rect x="8" y="11" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <path d="M8 14.5h16" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="20" cy="18.2" r="1.3" fill="currentColor" />
    </svg>
  );
}

export const WALLETS: readonly WalletDefinition[] = [
  {
    id: "metamask",
    name: "MetaMask",
    rdns: ["io.metamask", "io.metamask.mobile"],
    installUrl: "https://metamask.io/download/",
    flag: "isMetaMask",
    accent: "#E2761B",
    Icon: MetaMaskMark,
  },
  {
    id: "rabby",
    name: "Rabby",
    rdns: ["io.rabby", "app.rabby"],
    installUrl: "https://rabby.io/",
    flag: "isRabby",
    accent: "#7084FF",
    Icon: RabbyMark,
  },
  {
    id: "okx",
    name: "OKX Wallet",
    rdns: ["com.okex.wallet", "io.okex.wallet"],
    installUrl: "https://www.okx.com/web3",
    flag: "isOkxWallet",
    windowKey: "okxwallet",
    accent: "#141414",
    Icon: OkxMark,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    rdns: ["com.coinbase.wallet"],
    installUrl: "https://www.coinbase.com/wallet",
    flag: "isCoinbaseWallet",
    windowKey: "coinbaseWalletExtension",
    accent: "#0052FF",
    Icon: CoinbaseMark,
  },
  {
    id: "rainbow",
    name: "Rainbow",
    rdns: ["me.rainbow"],
    installUrl: "https://rainbow.me/download",
    flag: "isRainbow",
    accent: "#7A5AF8",
    Icon: RainbowMark,
  },
  {
    id: "browser",
    name: "Browser wallet",
    rdns: [],
    installUrl: "https://ethereum.org/en/wallets/find-wallet/",
    accent: "#6e6e73",
    Icon: BrowserMark,
  },
];

type WalletProviderLike = {
  request?: (...args: unknown[]) => unknown;
  providers?: WalletProviderLike[];
  [key: string]: unknown;
};

/** 从 window 上定位 legacy 注入 provider；SSR 或不存在时返回 undefined。 */
function findInjectedProvider(definition: WalletDefinition): WalletProviderLike | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as Record<string, unknown>;

  if (definition.windowKey) {
    const candidate = win[definition.windowKey] as WalletProviderLike | undefined;
    const direct = (candidate as { ethereum?: WalletProviderLike } | undefined)?.ethereum ?? candidate;
    if (direct && typeof direct.request === "function") return direct;
  }

  const ethereum = win.ethereum as WalletProviderLike | undefined;
  if (!ethereum || typeof ethereum.request !== "function") return undefined;
  if (!definition.flag) return ethereum;
  if (ethereum[definition.flag] === true) return ethereum;

  return Array.isArray(ethereum.providers)
    ? ethereum.providers.find((provider) => provider?.[definition.flag!] === true)
    : undefined;
}

export function matchesDefinition(connector: Connector | undefined, definition: WalletDefinition): boolean {
  if (!connector) return false;
  if (definition.rdns.length > 0) {
    const rdns = (connector as { rdns?: string | string[] }).rdns;
    const rdnsValues = typeof rdns === "string" ? [rdns] : (rdns ?? []);
    if (rdnsValues.some((value) => definition.rdns.includes(value))) return true;
    if (definition.rdns.includes(connector.id)) return true;
  }
  return connector.id === definition.id || connector.name === definition.name;
}

export type WalletOption = {
  definition: WalletDefinition;
  /** 可传给 `connect()` 的 connector 工厂或已注册实例。 */
  connector?: Connector | CreateConnectorFn;
  detected: boolean;
};

export function useWalletOptions(): WalletOption[] {
  const connectors = useConnectors();

  return WALLETS.map((definition) => {
    const registered = connectors.find((connector) => matchesDefinition(connector, definition));
    const provider = findInjectedProvider(definition);
    const detected = Boolean(registered) || Boolean(provider);

    // 优先复用已注册实例（id 稳定 → 可持久化自动重连），否则按需构造一次性的注入 connector。
    const connector = registered
      ?? (provider
        ? injected({
          target: {
            id: definition.id,
            name: definition.name,
            provider: () => provider as never,
          },
        })
        : undefined);

    return { definition, connector, detected };
  });
}
