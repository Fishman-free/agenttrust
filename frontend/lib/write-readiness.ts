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
};

export type WriteReadiness =
  | { ready: true; code: null; reason: null }
  | { ready: false; code: WriteBlockCode; reason: string };

const DEFAULT_REASONS: Record<WriteBlockCode, string> = {
  "not-configured": "合约尚未配置，当前无法提交交易。",
  "not-connected": "请先连接钱包。",
  "wrong-chain": "请切换到应用配置的网络。",
  busy: "上一笔交易仍在处理中。",
  unauthorized: "当前账户无权执行此操作。",
  "invalid-state": "当前链上状态不允许执行此操作。",
  "invalid-input": "请检查并补全有效输入。",
};

/** Pure, ordered write guard. Earlier infrastructure failures take precedence over form errors. */
export function getWriteReadiness(input: WriteReadinessInput): WriteReadiness {
  const code = firstBlockCode(input);
  if (code === null) return { ready: true, code: null, reason: null };
  return { ready: false, code, reason: input.reasons?.[code] ?? DEFAULT_REASONS[code] };
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
