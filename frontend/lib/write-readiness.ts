import { dictionaries, type Locale } from "./locale";

export type WriteBlockCode = "not-configured" | "not-connected" | "wrong-chain" | "busy" | "unauthorized" | "invalid-state" | "invalid-input";

export type WriteReadinessInput = {
  configured: boolean;
  connected: boolean;
  rightChain: boolean;
  busy: boolean;
  authorized: boolean;
  stateValid: boolean;
  inputValid: boolean;
  reasons?: Partial<Record<WriteBlockCode, string>>;
  locale?: Locale;
};

export type WriteReadiness =
  | { ready: true; code: null; reason: null }
  | { ready: false; code: WriteBlockCode; reason: string };

function defaultReasons(locale: Locale): Record<WriteBlockCode, string> {
  const t = dictionaries[locale].write;
  return { "not-configured": t.notConfigured, "not-connected": t.notConnected, "wrong-chain": t.wrongChain, busy: t.busy, unauthorized: t.unauthorized, "invalid-state": t.invalidState, "invalid-input": t.invalidInput };
}

/** Pure, ordered write guard. Earlier infrastructure failures take precedence over form errors. */
export function getWriteReadiness(input: WriteReadinessInput): WriteReadiness {
  const code = firstBlockCode(input);
  if (code === null) return { ready: true, code: null, reason: null };
  return { ready: false, code, reason: input.reasons?.[code] ?? defaultReasons(input.locale ?? "en")[code] };
}

export const assessWriteReadiness = getWriteReadiness;

export function isWriteReady(input: WriteReadinessInput): boolean {
  return getWriteReadiness(input).ready;
}

function firstBlockCode(input: WriteReadinessInput): WriteBlockCode | null {
  if (!input.configured) return "not-configured";
  if (!input.connected) return "not-connected";
  if (!input.rightChain) return "wrong-chain";
  if (input.busy) return "busy";
  if (!input.authorized) return "unauthorized";
  if (!input.stateValid) return "invalid-state";
  if (!input.inputValid) return "invalid-input";
  return null;
}
