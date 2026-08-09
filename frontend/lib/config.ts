// 本地 anvil 演示链（Task 13：真实部署受环境限制，改用本地演示；Base Sepolia 保留供未来真实部署切换）
import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

// 保留导出：真实部署时切换回 baseSepolia（并在 wagmi.ts 同步改回）
export { baseSepolia };

// 本地 anvil 演示链（id 31337，RPC 8545）
export const localAnvil = defineChain({
  id: 31337,
  name: "Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const CHAIN_ID = 31337;

// 本地 anvil 部署地址（Task 13：forge script script/Deploy.s.sol --broadcast 输出）
// as const 将字段收窄为字面量类型（0x 地址），满足 wagmi/viem 的 Address 类型要求
export const CONTRACT_ADDRESSES = {
  agentRegistry: "0x5fBDB2315678afecb367f032d93F642f64180aa3",
  reputationHub: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  guaranteeEscrow: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  schellingVoting: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;
