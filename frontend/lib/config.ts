// Base Sepolia 测试网（MVP 部署目标）
import { baseSepolia } from "viem/chains";

export { baseSepolia };

export const CHAIN_ID = 84532;

// 部署后由 Task 13 填入实际地址
export const CONTRACT_ADDRESSES = {
  agentRegistry: "0x0000000000000000000000000000000000000000",
  reputationHub: "0x0000000000000000000000000000000000000000",
  guaranteeEscrow: "0x0000000000000000000000000000000000000000",
  schellingVoting: "0x0000000000000000000000000000000000000000",
};
