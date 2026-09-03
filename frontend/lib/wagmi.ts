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
// ⚠️ ssr: true 不能删——它是首屏 hydration 正确性的前提，不是 SSR 框架专属选项。
//
// 背景：站点是 `output: "export"` 静态导出，HTML 在构建期生成，那时没有任何钱包连接，
// 页面里渲染的是「Connect Wallet」。浏览器端首帧必须与这份 HTML 一致，否则 React 会抛
// #418（hydration mismatch）。
//
// wagmi 默认 `ssr: false`，语义是「这里是纯客户端，可以立刻读本地存储」，于是：
//   1. createConfig 里 skipHydration=false → store 在**模块求值时**就同步把 localStorage
//      里的上次连接灌进来（@wagmi/core createConfig.js:198）；
//   2. EIP-6963 钱包发现（mipd）也在 createConfig 里同步完成（同文件 :28/:35 的 `!ssr` 分支）；
//   3. wagmi 的 Hydrate 组件因此在 **render 阶段**就调用 onMount()（wagmi/dist/esm/hydrate.js:11-12）。
// 三者叠加，首帧 useAccount() 已经返回 isConnected=true，与构建期 HTML 对不上 → #418。
//
// 改成 ssr: true 之后：skipHydration=true，store 不在创建时读盘；mipd 发现与 onMount()
// 全部推迟到 useEffect（hydrate.js:16-25），即 **hydration 完成之后**才恢复连接。
// 首帧与构建期 HTML 一致，恢复连接只是一次普通重渲染，不再触发 mismatch。
// reconnectOnMount 语义不变：老用户刷新后依然是静默恢复，不会多一次「连接」点击。
export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(),
  } as Record<(typeof activeChain)["id"], ReturnType<typeof http>>,
  ssr: true,
});
