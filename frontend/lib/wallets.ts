"use client";

/**
 * 钱包选择中枢。
 *
 * 背景（本次修复的根因）：所有连接入口此前都调用 `injected()` 且不带 `target`，
 * 该连接器会绑定到第一个被 EIP-6963 announce 的 provider（或 window.ethereum）；
 * agents 页更直接取 `connectors[0]`。结果是用户点过一次之后，
 * 后续每次连接都被固定到同一个钱包，永远无法切换。
 *
 * 这里改为：以 EIP-6963（wagmi multiInjectedProviderDiscovery，默认开启）发现的
 * 连接器为准，按 rdns 与策展品牌表匹配，产出「已检测 / 未安装」两类选项，
 * 由用户每次显式挑选。
 */

/** 判断连接器身份所需的最小结构；保留泛型以便把真实连接器原样透传给 wagmi。 */
export type DetectedConnector = {
  id: string;
  name: string;
  icon?: string;
  type?: string;
  rdns?: string | readonly string[];
};

export type WalletBrand = {
  /** EIP-6963 rdns，是识别钱包的唯一稳定标识。 */
  rdns: string;
  name: string;
  installUrl: string;
  /** provider 未提供图标时的兜底标记：渐变两色 + 字形。 */
  colors: readonly [string, string];
  glyph: string;
};

/** 策展顺序即展示顺序：Rabby 与 MetaMask 置顶（项目主要支持的两个钱包）。 */
export const WALLET_BRANDS: readonly WalletBrand[] = [
  { rdns: "io.rabby", name: "Rabby", installUrl: "https://rabby.io/", colors: ["#7084ff", "#3f4bd2"], glyph: "R" },
  { rdns: "io.metamask", name: "MetaMask", installUrl: "https://metamask.io/download/", colors: ["#f5841f", "#c25e0a"], glyph: "M" },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", installUrl: "https://www.coinbase.com/wallet", colors: ["#2c5ff6", "#123ecb"], glyph: "C" },
  { rdns: "com.okex.wallet", name: "OKX Wallet", installUrl: "https://www.okx.com/web3", colors: ["#101010", "#3d3d3d"], glyph: "O" },
  { rdns: "app.phantom", name: "Phantom", installUrl: "https://phantom.app/download", colors: ["#ab9ff2", "#6f5bd6"], glyph: "P" },
  { rdns: "me.rainbow", name: "Rainbow", installUrl: "https://rainbow.me/download", colors: ["#ff4000", "#7b53ff"], glyph: "🌈" },
  { rdns: "io.zerion.wallet", name: "Zerion", installUrl: "https://zerion.io/", colors: ["#2962ef", "#0f3fd6"], glyph: "Z" },
  { rdns: "com.trustwallet.app", name: "Trust Wallet", installUrl: "https://trustwallet.com/download", colors: ["#3375bb", "#1b4f85"], glyph: "T" },
];

const FALLBACK_COLORS: readonly [string, string] = ["#6e6e73", "#3a3a3c"];

export type WalletOption<T extends DetectedConnector> = {
  /** 列表稳定 key：已检测用 rdns 兜底到连接器 uid/id，未安装用品牌 rdns。 */
  key: string;
  name: string;
  rdns: string;
  /** provider 暴露的图标（data URI）；未检测时为 undefined，渲染兜底标记。 */
  icon?: string;
  colors: readonly [string, string];
  glyph: string;
  installUrl: string;
  connector?: T;
  detected: boolean;
  /** 非策展品牌、但仍被 EIP-6963 发现的通用钱包。 */
  generic: boolean;
};

function connectorRdns(connector: DetectedConnector): string {
  const { rdns } = connector;
  if (typeof rdns === "string" && rdns) return rdns;
  if (Array.isArray(rdns) && typeof rdns[0] === "string") return rdns[0];
  // 未显式声明 rdns 的注入式连接器，wagmi 会把 rdns 直接作为 id。
  return connector.id;
}

function collectRdns(connector: DetectedConnector): string[] {
  const values = new Set<string>();
  const primary = connectorRdns(connector);
  if (primary) values.add(primary);
  const { rdns } = connector;
  if (Array.isArray(rdns)) for (const value of rdns) if (typeof value === "string") values.add(value);
  return [...values];
}

/**
 * 把 wagmi 的发现结果与策展品牌表合并。
 * 排序：策展且已检测（保持策展顺序）→ 通用已检测 → 策展但未安装。
 */
export function buildWalletOptions<T extends DetectedConnector>(connectors: readonly T[]): WalletOption<T>[] {
  const detected = connectors.filter((connector) => connector.type !== "mock");
  const byRdns = new Map<string, T>();
  for (const connector of detected) {
    for (const rdns of collectRdns(connector)) {
      const key = rdns.toLowerCase();
      if (!byRdns.has(key)) byRdns.set(key, connector);
    }
  }

  const matched = new Set<T>();
  const primary: WalletOption<T>[] = [];
  const missing: WalletOption<T>[] = [];

  for (const brand of WALLET_BRANDS) {
    const connector = byRdns.get(brand.rdns.toLowerCase());
    const option: WalletOption<T> = {
      key: connector ? `detected:${brand.rdns}` : `install:${brand.rdns}`,
      name: connector?.name && connector.name !== "Injected" ? connector.name : brand.name,
      rdns: brand.rdns,
      icon: connector?.icon,
      colors: brand.colors,
      glyph: brand.glyph,
      installUrl: brand.installUrl,
      connector,
      detected: Boolean(connector),
      generic: false,
    };
    if (connector) {
      matched.add(connector);
      primary.push(option);
    } else {
      missing.push(option);
    }
  }

  // 策展表之外但仍被发现的钱包：不能 silently 丢弃，否则用户装了别的钱包就用不了。
  // 例外：配置里声明的无 target injected 兜底连接器（id/rdns 均为 "injected"）不算真实钱包品牌，
  // 只在 EIP-6963 一无所获时由 wallet-picker 以「浏览器钱包」呈现，这里不重复展示。
  const extras: WalletOption<T>[] = detected
    .filter((connector) => !matched.has(connector))
    .filter((connector) => !(connector.type === "injected" && connectorRdns(connector) === "injected"))
    .map((connector) => ({
      key: `detected:${connectorRdns(connector)}`,
      name: connector.name || connectorRdns(connector),
      rdns: connectorRdns(connector),
      icon: connector.icon,
      colors: FALLBACK_COLORS,
      glyph: (connector.name || connectorRdns(connector)).slice(0, 1).toUpperCase(),
      installUrl: "",
      connector,
      detected: true,
      generic: true,
    }));

  return [...primary, ...extras, ...missing];
}

export function findWalletOption<T extends DetectedConnector>(
  options: readonly WalletOption<T>[],
  rdns: string | undefined,
): WalletOption<T> | undefined {
  if (!rdns) return undefined;
  const key = rdns.toLowerCase();
  return options.find((option) => option.detected && option.rdns.toLowerCase() === key);
}

/* ---------------- 上次使用的钱包（仅本地偏好，用于在列表中标记） ---------------- */

export const WALLET_PREFERENCE_KEY = "agenttrust.wallet.preferredRdns";

export function readPreferredWallet(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(WALLET_PREFERENCE_KEY);
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function rememberPreferredWallet(rdns: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLET_PREFERENCE_KEY, rdns);
  } catch {
    // 隐私模式下写入失败不影响连接本身。
  }
}

