import { render, renderHook, screen } from "@testing-library/react";
import type { TransactionReceipt } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const waitMock = vi.hoisted(() => vi.fn());
vi.mock("wagmi", () => ({ useWaitForTransactionReceipt: waitMock }));

import { TransactionStatus, useTransactionFeedback, type TransactionFeedback } from "@/app/components/transaction-status";

const hash = `0x${"12".repeat(32)}` as const;
const receipt = { status: "success", blockNumber: 42n } as TransactionReceipt;

beforeEach(() => {
  waitMock.mockReset();
  waitMock.mockReturnValue({ isSuccess: false, data: undefined, error: null });
});

describe("useTransactionFeedback phases", () => {
  it("reports idle and wallet-submitting phases", () => {
    expect(renderHook(() => useTransactionFeedback({})).result.current.phase).toBe("idle");
    expect(renderHook(() => useTransactionFeedback({ isSubmitting: true })).result.current.phase).toBe("submitting");
  });

  it("keeps a submitted hash confirming until a receipt exists", () => {
    const result = renderHook(() => useTransactionFeedback({ hash })).result.current;
    expect(result).toEqual({ phase: "confirming", hash });
    expect(waitMock).toHaveBeenLastCalledWith({ hash, query: { enabled: true } });
  });

  it("only reports success after receipt confirmation and carries a custom label", () => {
    waitMock.mockReturnValue({ isSuccess: true, data: receipt, error: null });
    expect(renderHook(() => useTransactionFeedback({ hash, successLabel: "代理注册成功。" })).result.current).toEqual({
      phase: "success",
      hash,
      receipt,
      successLabel: "代理注册成功。",
    });
  });

  it("reports write, receipt, and reverted-transaction errors", () => {
    const writeError = new Error("wallet rejected");
    expect(renderHook(() => useTransactionFeedback({ writeError })).result.current).toMatchObject({ phase: "error", error: writeError });

    const receiptError = new Error("rpc failed");
    waitMock.mockReturnValue({ isSuccess: false, data: undefined, error: receiptError });
    expect(renderHook(() => useTransactionFeedback({ hash })).result.current).toMatchObject({ phase: "error", error: receiptError });

    waitMock.mockReturnValue({ isSuccess: true, data: { ...receipt, status: "reverted" }, error: null });
    expect(renderHook(() => useTransactionFeedback({ hash })).result.current).toMatchObject({ phase: "error", receipt: { status: "reverted" } });
  });
});

describe("TransactionStatus", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<TransactionStatus feedback={{ phase: "idle" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every active phase and receipt details", () => {
    const phases: Array<[TransactionFeedback, string]> = [
      [{ phase: "submitting" }, "等待钱包确认"],
      [{ phase: "confirming", hash }, "等待链上确认"],
      [{ phase: "success", hash, receipt, successLabel: "创建交易成功。" }, "创建交易成功"],
      [{ phase: "error", error: new Error("boom") }, "boom"],
    ];
    for (const [feedback, text] of phases) {
      const view = render(<TransactionStatus feedback={feedback} />);
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
      view.unmount();
    }
  });

  it("allows the component success label to override feedback", () => {
    render(<TransactionStatus feedback={{ phase: "success", receipt, successLabel: "旧标签" }} successLabel="已完成结算。" />);
    expect(screen.getByText("已完成结算。")).toBeInTheDocument();
    expect(screen.getByText("区块：42")).toBeInTheDocument();
  });
});
