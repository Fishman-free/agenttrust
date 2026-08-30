"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TransactionFeedback } from "@/app/components/transaction-status";

/**
 * 本地交易记录。
 *
 * 范围说明：这是纯浏览器侧的操作日志（本浏览器提交过的交易哈希与结果），
 * 用于账户面板「查看/管理交易记录」。它不等价于链上历史，
 * 也不作为任何结算依据——链上状态始终以合约为准。
 */

export const TX_HISTORY_KEY = "agenttrust.tx.history";
export const TX_HISTORY_LIMIT = 80;

export type TxKind = "agent" | "trade" | "dispute" | "deposit";
export type TxStatus = "pending" | "success" | "failed";

export type TxRecord = {
  /** 有哈希时即哈希；钱包内被拒绝、无哈希时用本地 id。 */
  id: string;
  hash?: string;
  kind: TxKind;
  label?: string;
  status: TxStatus;
  error?: string;
  /** 小写地址，用于按账户过滤。 */
  subject: string;
  chainId: number;
  timestamp: number;
  blockNumber?: string;
};

type TxHistoryFile = { version: 1; records: TxRecord[] };

function isRecord(value: unknown): value is TxRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TxRecord>;
  return typeof candidate.id === "string"
    && typeof candidate.kind === "string"
    && typeof candidate.status === "string"
    && typeof candidate.subject === "string"
    && typeof candidate.chainId === "number"
    && typeof candidate.timestamp === "number";
}

export function readTxHistory(): TxRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TX_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TxHistoryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records.filter(isRecord).slice(0, TX_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeTxHistory(records: TxRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    const file: TxHistoryFile = { version: 1, records: records.slice(0, TX_HISTORY_LIMIT) };
    window.localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(file));
  } catch {
    // 隐私模式或配额用尽：记录降级为仅本次会话有效。
  }
}

/** 同一笔交易（同 id + subject + chainId）只保留最新状态，按时间倒序。 */
export function mergeTxRecord(records: TxRecord[], next: TxRecord): TxRecord[] {
  const index = records.findIndex(
    (item) => item.id === next.id && item.subject === next.subject && item.chainId === next.chainId,
  );
  if (index === -1) {
    return [next, ...records].sort((a, b) => b.timestamp - a.timestamp).slice(0, TX_HISTORY_LIMIT);
  }
  const merged = [...records];
  merged[index] = { ...records[index], ...next };
  return merged;
}

type TxHistoryContextValue = {
  records: TxRecord[];
  ready: boolean;
  clear: (subject?: string) => void;
  commit: (next: TxRecord) => void;
};

const TxHistoryContext = createContext<TxHistoryContextValue>({
  records: [],
  ready: false,
  clear: () => {},
  commit: () => {},
});

export function TxHistoryProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<TxRecord[]>([]);
  const [ready, setReady] = useState(false);

  // 只在挂载后读取，避免 SSR 与首屏水合不一致。
  useEffect(() => {
    const stored = readTxHistory();
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecords(stored);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const commit = useCallback((next: TxRecord) => {
    setRecords((previous) => {
      const merged = mergeTxRecord(previous, next);
      writeTxHistory(merged);
      return merged;
    });
  }, []);

  const clear = useCallback((subject?: string) => {
    setRecords((previous) => {
      const kept = subject ? previous.filter((item) => item.subject !== subject) : [];
      writeTxHistory(kept);
      return kept;
    });
  }, []);

  const value = useMemo(() => ({ records, ready, clear, commit }), [records, ready, clear, commit]);
  return <TxHistoryContext.Provider value={value}>{children}</TxHistoryContext.Provider>;
}

function useTxStore() {
  return useContext(TxHistoryContext);
}

export function useTxHistory() {
  const { records, ready, clear } = useTxStore();
  return { records, ready, clear };
}

export type TxRecorderMeta = {
  kind: TxKind;
  subject?: string;
  chainId?: number;
  label?: string;
};

/**
 * 把页面的 TransactionFeedback 落库。
 * 有哈希时以哈希为键幂等更新；钱包内被拒绝（无哈希）时按错误对象去重，只记一次。
 */
export function useTxRecorder(feedback: TransactionFeedback, meta: TxRecorderMeta): void {
  const { commit } = useTxStore();
  const localId = useRef(0);
  const lastError = useRef<unknown>(undefined);

  const { hash, phase, error, receipt, successLabel } = feedback;
  const label = meta.label ?? successLabel;
  const subject = meta.subject?.toLowerCase();
  const errorText = error ? ("shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : error.message) : undefined;

  useEffect(() => {
    // 没有账户或没有已连接网络时不可能存在待记录的交易，直接跳过。
    if (!subject || meta.chainId === undefined) return;
    if (phase === "idle") return;

    if (hash) {
      commit({
        id: hash,
        hash,
        kind: meta.kind,
        label,
        status: phase === "success" ? "success" : phase === "error" ? "failed" : "pending",
        error: phase === "error" ? errorText : undefined,
        subject,
        chainId: meta.chainId,
        timestamp: Date.now(),
        blockNumber: receipt?.blockNumber?.toString(),
      });
      return;
    }

    if (phase === "error") {
      if (lastError.current === error) return;
      lastError.current = error;
      localId.current += 1;
      commit({
        id: `local-${localId.current}`,
        kind: meta.kind,
        label,
        status: "failed",
        error: errorText,
        subject,
        chainId: meta.chainId,
        timestamp: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hash, subject, meta.kind, meta.chainId, label, errorText, receipt, commit]);
}
