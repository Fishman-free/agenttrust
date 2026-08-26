"use client";

import type { Hash, TransactionReceipt } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { dictionaries, useLocale } from "@/lib/locale";

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
    return { phase: "error", hash, receipt: receipt.data, error: new Error(dictionaries.en.transaction.reverted) };
  }
  if (receipt.isSuccess && receipt.data) return { phase: "success", hash, receipt: receipt.data, successLabel };
  if (hash) return { phase: "confirming", hash };
  return { phase: "idle" };
}

function friendlyError(error: Error, fallback: string) {
  const cause = "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : error.message;
  return cause || fallback;
}

export function TransactionStatus({
  feedback,
  successLabel,
}: {
  feedback: TransactionFeedback;
  successLabel?: string;
}) {
  const { dictionary: t } = useLocale();
  if (feedback.phase === "idle") return null;

  const isError = feedback.phase === "error";
  const message = {
    submitting: t.transaction.submitting,
    confirming: t.transaction.confirming,
    success: successLabel ?? feedback.successLabel ?? t.transaction.success,
    error: feedback.error ? friendlyError(feedback.error, t.transaction.failed) : t.transaction.failed,
    idle: "",
  }[feedback.phase];

  return (
    <div className={`transaction-status transaction-${feedback.phase}`} role={isError ? "alert" : "status"} aria-live="polite">
      <strong>{message}</strong>
      {feedback.hash && <span>{t.transaction.hash}<code>{feedback.hash}</code></span>}
      {feedback.receipt && <span>{t.transaction.block}{feedback.receipt.blockNumber.toString()}</span>}
    </div>
  );
}
