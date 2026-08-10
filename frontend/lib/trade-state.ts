export const TRADE_STATE_COUNT = 10;

export type TradeState = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type TradeStateKey = "CREATED" | "ACCEPTED" | "FUNDED" | "GUARANTEE_OFFERED" | "GUARANTEED" | "DELIVERED" | "DISPUTED" | "RELEASED" | "RESOLVED" | "VOIDED";
export type TradeAction = "acceptTrade" | "fund" | "guarantee" | "acceptGuarantee" | "deliver" | "confirm" | "dispute" | "openArbitration" | "resolveDispute" | "timeoutCancelUnaccepted" | "timeoutCancelUnfunded" | "timeoutRejectGuarantee" | "timeoutRefund" | "timeoutAutoRelease" | "timeoutVoidDispute" | "retryOutcome";

export type TradeActionMeta = {
  action: TradeAction;
  label: string;
  role: "buyer" | "seller" | "guarantor" | "owner" | "anyone";
};

export type TradeStateMeta = {
  value: TradeState;
  key: TradeStateKey;
  label: string;
  terminal: boolean;
  actions: readonly TradeActionMeta[];
};

const action = (name: TradeAction, label: string, role: TradeActionMeta["role"]): TradeActionMeta => ({ action: name, label, role });

export const TRADE_STATE_META = [
  { value: 0, key: "CREATED", label: "已创建", terminal: false, actions: [action("acceptTrade", "接受交易", "seller"), action("timeoutCancelUnaccepted", "超时取消", "anyone")] },
  { value: 1, key: "ACCEPTED", label: "已接受", terminal: false, actions: [action("fund", "托管资金", "buyer"), action("timeoutCancelUnfunded", "超时取消", "anyone")] },
  { value: 2, key: "FUNDED", label: "已托管", terminal: false, actions: [action("guarantee", "提供担保", "guarantor"), action("timeoutRefund", "超时退款", "anyone")] },
  { value: 3, key: "GUARANTEE_OFFERED", label: "担保已报价", terminal: false, actions: [action("acceptGuarantee", "接受担保", "seller"), action("timeoutRejectGuarantee", "超时拒绝担保", "anyone")] },
  { value: 4, key: "GUARANTEED", label: "担保生效", terminal: false, actions: [action("deliver", "确认交付", "seller"), action("timeoutRefund", "超时退款", "anyone")] },
  { value: 5, key: "DELIVERED", label: "已交付", terminal: false, actions: [action("confirm", "确认完成", "buyer"), action("dispute", "发起争议", "buyer"), action("timeoutAutoRelease", "超时自动放款", "anyone")] },
  { value: 6, key: "DISPUTED", label: "争议中", terminal: false, actions: [action("openArbitration", "开启仲裁", "owner"), action("resolveDispute", "执行裁决", "owner"), action("timeoutVoidDispute", "超时撤销争议", "anyone")] },
  { value: 7, key: "RELEASED", label: "已放款", terminal: true, actions: [action("retryOutcome", "重试记录结果", "anyone")] },
  { value: 8, key: "RESOLVED", label: "已裁决", terminal: true, actions: [action("retryOutcome", "重试记录结果", "anyone")] },
  { value: 9, key: "VOIDED", label: "已作废", terminal: true, actions: [] },
] as const satisfies readonly TradeStateMeta[];

export const TRADE_STATE_BY_VALUE: Readonly<Record<TradeState, TradeStateMeta>> = Object.freeze(
  Object.fromEntries(TRADE_STATE_META.map((state) => [state.value, state])) as unknown as Record<TradeState, TradeStateMeta>,
);

export function isTradeState(value: number | bigint): value is TradeState {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return Number.isInteger(numeric) && numeric >= 0 && numeric < TRADE_STATE_COUNT;
}

export function getTradeStateMeta(value: number | bigint): TradeStateMeta | undefined {
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return isTradeState(numeric) ? TRADE_STATE_BY_VALUE[numeric] : undefined;
}

export function requireTradeStateMeta(value: number | bigint): TradeStateMeta {
  const meta = getTradeStateMeta(value);
  if (!meta) throw new RangeError(`Unknown trade state: ${value.toString()}`);
  return meta;
}
