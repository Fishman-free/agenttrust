import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";

export const APP_ID = "app_01728cabff1e05950af1ff18c06c9d38" as const;
export const RP_ID = "rp_fd884ac4342cc4d1" as const;
export const ACTION = "agenttrust-register-v1" as const;
export const CHAIN_ID = 84532;
export const ORIGIN = "https://agenttrust.site";

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8322),
  WORLD_ID_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  WORLD_ID_ATTESTER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  WORLD_ID_ADAPTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  WORLD_ID_VERIFY_URL: z.string().url().default(`https://developer.world.org/api/v4/verify/${RP_ID}`),
  WORLD_ID_ATTESTATION_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  WORLD_ID_CONTEXT_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = envSchema.parse(source);
  return {
    ...value,
    WORLD_ID_SIGNER_PRIVATE_KEY: value.WORLD_ID_SIGNER_PRIVATE_KEY as Hex,
    WORLD_ID_ATTESTER_PRIVATE_KEY: value.WORLD_ID_ATTESTER_PRIVATE_KEY as Hex,
    WORLD_ID_ADAPTER_ADDRESS: getAddress(value.WORLD_ID_ADAPTER_ADDRESS) as Address,
  };
}
