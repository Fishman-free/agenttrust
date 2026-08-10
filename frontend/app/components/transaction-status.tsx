"use client";

import type { Hash, TransactionReceipt } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";

export type TransactionPhase = "idle" | "submitting" | "confirming" | "success" | "error";

export type TransactionFeedback = {
  phase: TransactionPhase;
  hash?: Hash;
  error?: Error | null;
  receipt?: TransactionReceipt;
};

export function useTransactionFeedback({
  hash,
  isSubmitting = false,
  writeError,
}: {
  hash?: Hash;
  isSubmitting?: boolean;
  writeError?: Error | null;
}): TransactionFeedback {
  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  if (writeError) return { phase: "error", hash, error: writeError };
  if (receipt.error) return { phase: "error", hash, error: receipt.error };
  if (receipt.isSuccess) return { phase: "success", hash, receipt: receipt.data };
  if (hash) return { phase: "confirming", hash };
  if (isSubmitting) return { phase: "submitting" };
  return { phase: "idle" };
}

function friendlyError(error: Error) {
  const cause = "shortMessage" in error && typeof error.shortMessage === "string"
    ? error.shortMessage
    : error.message;
  return cause || "交易失败，请检查钱包与网络后重试。";
}

export function TransactionStatus({ feedback }: { feedback: TransactionFeedback }) {
  if (feedback.phase === "idle") return null;

  const isError = feedback.phase === "error";
  const message = {
    submitting: "等待钱包确认…",
    confirming: "交易已提交，等待链上确认…",
    success: "交易已确认。",
    error: feedback.error ? friendlyError(feedback.error) : "交易失败。",
    idle: "",
  }[feedback.phase];

  return (
    <div className={`transaction-status transaction-${feedback.phase}`} role={isError ? "alert" : "status"} aria-live="polite">
      <strong>{message}</strong>
      {feedback.hash && <span>交易哈希：<code>{feedback.hash}</code></span>}
      {feedback.receipt && <span>区块：{feedback.receipt.blockNumber.toString()}</span>}
    </div>
  );
}
