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
