"use client";
import { createConfig, http } from "wagmi";
import { activeChain } from "./config";

// 单链配置：transports 键按 activeChain.id 动态绑定。
// http() 无参时取链自带 RPC——anvil 走 http://127.0.0.1:8545，base-sepolia 走 viem 内置公共 RPC。
// 说明：activeChain 为 baseSepolia | localAnvil 联合，computed key 推断不足以满足
// wagmi 的 Record<chainId, Transport>，故用 as 断言收窄键为联合字面量 id。
export const wagmiConfig = createConfig({
  chains: [activeChain],
  transports: {
    [activeChain.id]: http(),
  } as Record<(typeof activeChain)["id"], ReturnType<typeof http>>,
});

/** Storage key where wagmi persists the recently used connector id.
 *
 * Wagmi reads this on `WagmiProvider` mount and, if set, calls `reconnect()` synchronously.
 * That race used to swallow the wallet picker: a user who connected MetaMask once and then
 * killed MetaMask would click "Connect wallet", the picker would race against
 * `reconnect()` re-firing MetaMask, and the user saw it as "MetaMask jumped straight to
 * MetaMask with no choice". `<WagmiProviders>` disables that on mount so every connection
 * starts from the picker (a single, observable source of truth). If the user explicitly
 * wants to re-enter the auto-reconnect path, the account menu can clear this key first.
 */
export const WAGMI_RECENT_CONNECTOR_KEY = "wagmi.recentConnectorId";
