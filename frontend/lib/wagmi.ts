"use client";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { activeChain } from "./config";

// 单链配置：transports 键按 activeChain.id 动态绑定。
// http() 无参时取链自带 RPC——anvil 走 http://127.0.0.1:8545，base-sepolia 走 viem 内置公共 RPC。
// 说明：activeChain 为 baseSepolia | localAnvil 联合，computed key 推断不足以满足
// wagmi 的 Record<chainId, Transport>，故用 as 断言收窄键为联合字面量 id。
// connectors 声明一个无 target 的 injected 作为兜底：EIP-6963 发现不到任何钱包时
// 选择页会以「浏览器钱包」呈现它（见 wallet-picker）；有多钱包时它被隐藏，不会干扰选择。
export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(),
  } as Record<(typeof activeChain)["id"], ReturnType<typeof http>>,
});
