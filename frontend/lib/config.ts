// 链与环境配置：链元数据与合约地址来自 deployments/*.json 的生成模块。
// 修改 manifest 后运行 node scripts/deployment-manifest.mjs generate，并在 CI 中用 check 防漂移。
import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";
import { DEPLOYMENTS, type DeploymentContracts } from "./deployments";

const anvilDeployment = DEPLOYMENTS[31337];

// 本地 anvil 演示链（id 31337，RPC 8545）
export const localAnvil = defineChain({
  id: anvilDeployment.chainId,
  name: anvilDeployment.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [anvilDeployment.rpcUrl] } },
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

export type AddressMap = DeploymentContracts;

const activeDeployment = DEPLOYMENTS[CHAIN_ID];
export const CONTRACT_ADDRESSES: AddressMap = activeDeployment.contracts;

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
