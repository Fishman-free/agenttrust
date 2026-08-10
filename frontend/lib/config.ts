// 链与环境配置：用 NEXT_PUBLIC_CHAIN 区分部署目标
// - "anvil"（默认）：本地开发，连 http://127.0.0.1:8545（forge anvil 标准地址）
// - "base-sepolia"：GitHub Pages 部署版，连 Base Sepolia 公共测试网（占位地址，真实部署后填入）
// 核心原则：代码里不硬编码链选择，一律经 activeChain / CONTRACT_ADDRESSES 取用。
import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

// 本地 anvil 演示链（id 31337，RPC 8545）
export const localAnvil = defineChain({
  id: 31337,
  name: "Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export type ChainMode = "anvil" | "base-sepolia";

export function resolveChainMode(value: string | undefined): ChainMode {
  if (value === undefined || value === "") return "anvil";
  if (value === "anvil" || value === "base-sepolia") return value;
  throw new Error(`不支持的 NEXT_PUBLIC_CHAIN: ${value}`);
}

// 链选择：NEXT_PUBLIC_CHAIN = "anvil" | "base-sepolia"，默认 anvil（本地开发）
export const CHAIN_MODE = resolveChainMode(process.env.NEXT_PUBLIC_CHAIN);
export const CHAIN_ID = CHAIN_MODE === "base-sepolia" ? baseSepolia.id : localAnvil.id;

// 当前生效链：wagmi/viem 统一经此取用
export const activeChain = CHAIN_MODE === "base-sepolia" ? baseSepolia : localAnvil;

export type AddressMap = {
  agentRegistry: `0x${string}`;
  reputationHub: `0x${string}`;
  guaranteeEscrow: `0x${string}`;
  schellingVoting: `0x${string}`;
};

// 合约地址：部署版（base-sepolia）用占位地址（真实部署后填入）；
// 本地用 anvil 标准部署地址（Task 13：forge script script/Deploy.s.sol --broadcast 输出）
export const CONTRACT_ADDRESSES: AddressMap =
  CHAIN_MODE === "base-sepolia"
    ? {
        // TODO: 真实部署到 Base Sepolia 后填入实际地址
        agentRegistry: "0x0000000000000000000000000000000000000000",
        reputationHub: "0x0000000000000000000000000000000000000000",
        guaranteeEscrow: "0x0000000000000000000000000000000000000000",
        schellingVoting: "0x0000000000000000000000000000000000000000",
      }
    : {
        agentRegistry: "0x5fBDB2315678afecb367f032d93F642f64180aa3",
        reputationHub: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        guaranteeEscrow: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
        schellingVoting: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function isZeroAddress(address: `0x${string}`): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

export function areContractAddressesConfigured(addresses: AddressMap): boolean {
  return Object.values(addresses).every((address) => !isZeroAddress(address));
}

/** 可写操作的统一安全开关；任一部署地址为零时必须禁用交易。 */
export const WRITES_ENABLED = areContractAddressesConfigured(CONTRACT_ADDRESSES);

export const WRITE_BLOCK_REASON = WRITES_ENABLED
  ? undefined
  : `${activeChain.name} 的合约尚未部署，已禁用所有可写操作。`;
