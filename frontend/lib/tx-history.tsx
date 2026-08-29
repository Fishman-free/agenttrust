"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import type { Hash } from "viem";

/**
 * 交易记录：本浏览器发起的链上操作流水，按地址分组保存在 localStorage。
 * 只作为操作留痕（hash + 语义标签 + 状态），不替代区块浏览器。
 */

const STORAGE_KEY = "agenttrust.transactions";
const MAX_ENTRIES = 40;

export type TxKind = "register" | "bind" | "deregister" | "withdraw" | "recovery" | "trade" | "vote" | "other";
export type TxStatus = "pending" | "success" | "error";

export type TxEntry = {
  hash: Hash;
  label: string;
  kind: TxKind;
  status: TxStatus;
  timestamp: number;
  chainId: number;
};

type TxMap = Record<string, TxEntry[]>;

export type TxHistoryApi = {
  ready: boolean;
  entries: TxEntry[];
  record: (entry: Omit<TxEntry, "status" | "timestamp"> & { status?: TxStatus; timestamp?: number }) => void;
  markStatus: (hash: Hash, status: TxStatus) => void;
  clear: () => void;
};

const defaultApi: TxHistoryApi = {
  ready: false,
  entries: [],
  record: () => { },
  markStatus: () => { },
  clear: () => { },
};

const TxHistoryContext = createContext<TxHistoryApi>(defaultApi);

export function useTxHistory(): TxHistoryApi {
  return useContext(TxHistoryContext);
}

function read(): TxMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as TxMap;
  } catch {
    return {};
  }
}

export function TxHistoryProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [history, setHistory] = useState<TxMap>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 同上：外部数据源只在 hydration 之后读取。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(read());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // 写不进去时保持内存态，不影响当前会话。
    }
  }, [history, ready]);

  const key = address?.toLowerCase();

  const record: TxHistoryApi["record"] = useCallback((entry) => {
    if (!key) return;
    const next: TxEntry = {
      ...entry,
      status: entry.status ?? "pending",
      timestamp: entry.timestamp ?? Date.now(),
    };
    setHistory((current) => {
      const existing = current[key] ?? [];
      const withoutDuplicate = existing.filter((item) => item.hash !== next.hash);
      return { ...current, [key]: [next, ...withoutDuplicate].slice(0, MAX_ENTRIES) };
    });
  }, [key]);

  const markStatus = useCallback((hash: Hash, status: TxStatus) => {
    if (!key) return;
    setHistory((current) => {
      const existing = current[key];
      if (!existing) return current;
      return {
        ...current,
        [key]: existing.map((item) => (item.hash === hash ? { ...item, status } : item)),
      };
    });
  }, [key]);

  const clear = useCallback(() => {
    if (!key) return;
    setHistory((current) => ({ ...current, [key]: [] }));
  }, [key]);

  const entries = useMemo(() => (key ? (history[key] ?? []) : []), [history, key]);

  const value = useMemo<TxHistoryApi>(
    () => ({ ready, entries, record, markStatus, clear }),
    [ready, entries, record, markStatus, clear],
  );

  return <TxHistoryContext.Provider value={value}>{children}</TxHistoryContext.Provider>;
}
