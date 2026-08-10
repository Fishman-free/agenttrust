import type { Hash } from "viem";

export type TradeOperationKind =
  | "create"
  | "guarantee"
  | "withdraw"
  | "acceptTrade"
  | "fund"
  | "acceptGuarantee"
  | "deliver"
  | "confirm"
  | "timeoutCancelUnaccepted"
  | "timeoutCancelUnfunded"
  | "timeoutRejectGuarantee"
  | "timeoutRefund"
  | "timeoutAutoRelease"
  | "timeoutVoidDispute"
  | "retryOutcome";

export type TradePendingOperation = {
  id: number;
  kind: TradeOperationKind;
  hash?: Hash;
};

/** Synchronous gate used before React can render its pending state. */
export class TradeSubmissionGate {
  private sequence = 0;
  private operation?: TradePendingOperation;

  begin(kind: TradeOperationKind): TradePendingOperation | undefined {
    if (this.operation) return undefined;
    this.operation = { id: ++this.sequence, kind };
    return this.operation;
  }

  current(): TradePendingOperation | undefined {
    return this.operation;
  }

  bindHash(id: number, hash: Hash): TradePendingOperation | undefined {
    if (this.operation?.id !== id || this.operation.hash) return undefined;
    this.operation = { ...this.operation, hash };
    return this.operation;
  }

  matches(hash: Hash): boolean {
    return this.operation?.hash === hash;
  }

  finish(id: number): boolean {
    if (this.operation?.id !== id) return false;
    this.operation = undefined;
    return true;
  }
}
