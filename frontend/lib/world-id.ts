import type { IDKitResult, RpContext } from "@worldcoin/idkit";

export const WORLD_ID_APP_ID = "app_01728cabff1e05950af1ff18c06c9d38" as const;
export const WORLD_ID_ACTION = "agenttrust-register-v1" as const;
export const WORLD_ID_API = "/api/world-id";

export type WorldIdContext = {
  app_id: typeof WORLD_ID_APP_ID;
  action: typeof WORLD_ID_ACTION;
  environment: "production";
  rp_context: RpContext;
};
export type RegistryAttestation = { nullifier: `0x${string}`; proof: `0x${string}` };

async function checkedJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `world_id_http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchWorldIdContext(fetchImpl: typeof fetch = fetch): Promise<WorldIdContext> {
  return checkedJson<WorldIdContext>(await fetchImpl(`${WORLD_ID_API}/context`, { headers: { accept: "application/json" }, credentials: "same-origin" }));
}

export async function verifyWorldId(subject: `0x${string}`, result: IDKitResult, fetchImpl: typeof fetch = fetch): Promise<RegistryAttestation> {
  return checkedJson<RegistryAttestation>(await fetchImpl(`${WORLD_ID_API}/verify`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "same-origin", body: JSON.stringify({ subject, result }),
  }));
}
