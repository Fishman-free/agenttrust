import { z } from "zod";

export const PURPOSES = ["wallet_login", "wallet_link"] as const;
export const PROVIDERS = ["google", "apple", "casdoor"] as const;
export type Purpose = (typeof PURPOSES)[number];
export type Provider = (typeof PROVIDERS)[number];

const optionalUrl = z.union([z.literal(""), z.string().url()]).default("");
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8323),
  DATABASE_URL: z.string().min(1),
  AUTH_ORIGIN: z.string().url(),
  SIWE_DOMAIN: z.string().min(1),
  SIWE_URI: z.string().url(),
  SIWE_CHAIN_ID: z.coerce.number().int().positive().default(84532),
  RETURN_TO_ORIGINS: z.string().min(1),
  TRUST_PROXY: z.enum(["false", "true", "loopback"]).default("false"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  COOKIE_NAME: z.string().min(1).default("__Host-auth_session"),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
  OIDC_FLOW_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  GOOGLE_OIDC_ISSUER: optionalUrl, GOOGLE_OIDC_CLIENT_ID: z.string().default(""), GOOGLE_OIDC_CLIENT_SECRET: z.string().default(""), GOOGLE_OIDC_REDIRECT_URI: optionalUrl,
  APPLE_OIDC_ISSUER: optionalUrl, APPLE_OIDC_CLIENT_ID: z.string().default(""), APPLE_OIDC_CLIENT_SECRET: z.string().default(""), APPLE_OIDC_REDIRECT_URI: optionalUrl,
  CASDOOR_OIDC_ISSUER: optionalUrl, CASDOOR_OIDC_CLIENT_ID: z.string().default(""), CASDOOR_OIDC_CLIENT_SECRET: z.string().default(""), CASDOOR_OIDC_REDIRECT_URI: optionalUrl,
  AGENT_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default(""),
  AGENT_REGISTRY_RPC_URL: z.string().url().default(""),
  IDENTITY_VERIFIER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).default(""),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const value = envSchema.parse(source);
  const cookieSecure = value.COOKIE_SECURE === "true";
  if (cookieSecure && !value.COOKIE_NAME.startsWith("__Host-")) throw new Error("secure cookie name must use __Host- prefix");
  if (!cookieSecure && value.COOKIE_NAME.startsWith("__Host-")) throw new Error("development cookie name cannot use __Host- without Secure");
  if (value.NODE_ENV === "production" && !cookieSecure) throw new Error("production cookies must be Secure");
  const authOrigin = new URL(value.AUTH_ORIGIN).origin;
  const returnToOrigins = value.RETURN_TO_ORIGINS.split(",").map((item) => new URL(item.trim()).origin);
  const oidc = Object.fromEntries(PROVIDERS.map((provider) => {
    const prefix = provider.toUpperCase() as Uppercase<Provider>;
    const issuer = value[`${prefix}_OIDC_ISSUER`];
    const clientId = value[`${prefix}_OIDC_CLIENT_ID`];
    const clientSecret = value[`${prefix}_OIDC_CLIENT_SECRET`];
    const redirectUri = value[`${prefix}_OIDC_REDIRECT_URI`];
    const configured = Boolean(issuer && clientId && clientSecret && redirectUri);
    return [provider, { configured, issuer, clientId, clientSecret, redirectUri }];
  })) as Record<Provider, { configured: boolean; issuer: string; clientId: string; clientSecret: string; redirectUri: string }>;
  return {
    ...value,
    authOrigin,
    returnToOrigins,
    cookieSecure,
    csrfCookieName: cookieSecure ? "__Host-auth_csrf" : `${value.COOKIE_NAME}_csrf`,
    trustProxy: value.TRUST_PROXY === "true" ? true : value.TRUST_PROXY === "loopback" ? "127.0.0.1" : false,
    oidc,
  };
}
