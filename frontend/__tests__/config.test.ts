import { describe, expect, it } from "vitest";
import {
  areContractAddressesConfigured,
  isZeroAddress,
  resolveChainMode,
  ZERO_ADDRESS,
  type AddressMap,
} from "@/lib/config";
import { DEPLOYMENTS } from "@/lib/deployments";

const deployed: AddressMap = {
  agentRegistry: "0x1111111111111111111111111111111111111111",
  reputationHub: "0x2222222222222222222222222222222222222222",
  guaranteeEscrow: "0x3333333333333333333333333333333333333333",
  schellingVoting: "0x4444444444444444444444444444444444444444",
};

describe("chain configuration", () => {
  it("defaults to anvil and accepts supported modes", () => {
    expect(resolveChainMode(undefined)).toBe("anvil");
    expect(resolveChainMode("")).toBe("anvil");
    expect(resolveChainMode("base-sepolia")).toBe("base-sepolia");
  });

  it("rejects unknown modes instead of silently selecting a chain", () => {
    expect(() => resolveChainMode("mainnet")).toThrow(/Unsupported/);
  });

  it("uses generated manifests with an explicit testnet deployment state", () => {
    expect(DEPLOYMENTS[31337].status).toBe("deployed");
    expect(areContractAddressesConfigured(DEPLOYMENTS[31337].contracts)).toBe(true);
    expect(DEPLOYMENTS[84532].status).toBe("undeployed");
    expect(areContractAddressesConfigured(DEPLOYMENTS[84532].contracts)).toBe(false);
  });
});

describe("deployment write guard", () => {
  it("recognizes a zero address regardless of case", () => {
    expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
    expect(isZeroAddress("0x000000000000000000000000000000000000000A")).toBe(false);
  });

  it("only enables writes when every contract is deployed", () => {
    expect(areContractAddressesConfigured(deployed)).toBe(true);
    expect(areContractAddressesConfigured({ ...deployed, agentRegistry: ZERO_ADDRESS })).toBe(false);
  });
});
