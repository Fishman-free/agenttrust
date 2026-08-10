"use client";

import type { Hash, TransactionReceipt } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";

export type TransactionPhase = "idle" | "submitting" | "confirming" | "success" | "error";

export type TransactionFeedback = {
  phase: TransactionPhase;
  hash?: Hash;
  error?: Error | null;
  receipt?: TransactionReceipt;
  successLabel?: string;
};

export type TransactionFeedbackOptions = {
  hash?: Hash;
  isSubmitting?: boolean;
  writeError?: Error | null;
  successLabel?: string;
};

export function useTransactionFeedback({
  hash,
  isSubmitting = false,
  writeError,
  successLabel,
}: TransactionFeedbackOptions): TransactionFeedback {
  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  if (writeError) return { phase: "error", hash, error: writeError };
  if (isSubmitting) return { phase: "submitting" };
  if (receipt.error) return { phase: "error", hash, error: receipt.error };
  if (receipt.isSuccess && receipt.data?.status === "reverted") {
    return { phase: "error", hash, receipt: receipt.data, error: new Error("交易已上链但执行回滚。") };
  }
  if (receipt.isSuccess && receipt.data) return { phase: "success", hash, receipt: receipt.data, successLabel };
  if (hash) return { phase: "confirming", hash };
  return { phase: "idle" };
}

function friendlyError(error: Error) {
  const cause = "shortMessage" in error && typeof error.shortMessage === "string"
    ? error.shortMessage
    : error.message;
  return cause || "交易失败，请检查钱包与网络后重试。";
}

export function TransactionStatus({
  feedback,
  successLabel,
}: {
  feedback: TransactionFeedback;
  successLabel?: string;
}) {
  if (feedback.phase === "idle") return null;

  const isError = feedback.phase === "error";
  const message = {
    submitting: "等待钱包确认…",
    confirming: "交易已提交，等待链上确认…",
    success: successLabel ?? feedback.successLabel ?? "交易已确认。",
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
