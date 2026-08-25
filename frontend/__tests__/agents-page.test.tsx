import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { address: "0x1111111111111111111111111111111111111111", chainId: 31337, isConnected: true },
  connector: { id: "configured-injected" },
  connect: vi.fn(),
  writeContract: vi.fn(),
  refetchCount: vi.fn(),
  refetchList: vi.fn(),
  activeSubject: false,
  pohVerified: false,
  feedback: { current: { phase: "confirming", hash: `0x${"12".repeat(32)}` } as Record<string, unknown> },
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnect: () => ({ connect: mocks.connect, connectors: [mocks.connector], isPending: false }),
  useWriteContract: () => ({ data: mocks.feedback.current.hash, writeContract: mocks.writeContract, isPending: false, error: null }),
  useReadContract: ({ functionName }: { functionName: string }) => {
    if (functionName === "registrationDeposit") return { data: BigInt(1) };
    if (functionName === "activeSubjects") return { data: mocks.activeSubject, refetch: mocks.refetchCount };
    if (functionName === "isPoHVerified") return { data: mocks.pohVerified, refetch: mocks.refetchCount };
    return { data: BigInt(0), refetch: mocks.refetchCount };
  },
  useReadContracts: () => ({ data: [], refetch: mocks.refetchList }),
}));

vi.mock("@/lib/config", () => ({
  CHAIN_ID: 31337,
  CONTRACT_ADDRESSES: { agentRegistry: "0x2222222222222222222222222222222222222222" },
  WRITE_BLOCK_REASON: undefined,
  WRITES_ENABLED: true,
  activeChain: { id: 31337, name: "Anvil" },
  isZeroAddress: () => false,
}));

vi.mock("@/lib/receipt-events", () => ({
  parseAgentRegistered: () => ({ args: { tokenId: BigInt(7) } }),
}));

vi.mock("@/app/components/transaction-status", () => ({
  useTransactionFeedback: () => mocks.feedback.current,
  TransactionStatus: ({ successLabel }: { successLabel?: string }) => <div>{successLabel}</div>,
}));

import AgentsPage from "@/app/(app)/agents/page";

beforeEach(() => {
  mocks.account.address = "0x1111111111111111111111111111111111111111";
  mocks.account.chainId = 31337;
  mocks.account.isConnected = true;
  mocks.activeSubject = false;
  mocks.pohVerified = false;
  mocks.feedback.current = { phase: "confirming", hash: `0x${"12".repeat(32)}` };
  vi.clearAllMocks();
});

describe("AgentsPage", () => {
  it("refetches and reports the new Agent ID only after a confirmed receipt", async () => {
    const view = render(<AgentsPage />);
    expect(mocks.refetchCount).not.toHaveBeenCalled();
    expect(mocks.refetchList).not.toHaveBeenCalled();

    mocks.feedback.current = {
      phase: "success",
      hash: `0x${"12".repeat(32)}`,
      receipt: { transactionHash: `0x${"12".repeat(32)}`, logs: [] },
    };
    view.rerender(<AgentsPage />);

    expect(await screen.findByText(/注册成功，新 Agent ID：7/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.refetchCount).toHaveBeenCalled();
      expect(mocks.refetchList).toHaveBeenCalledOnce();
    });
  });

  it("uses the configured connector instead of constructing a duplicate", async () => {
    mocks.account.isConnected = false;
    render(<AgentsPage />);

    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    expect(mocks.connect).toHaveBeenCalledWith({ connector: mocks.connector });
  });

  it("blocks registration on the wrong chain", () => {
    mocks.account.chainId = 1;
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("网络错误");
    expect(screen.getByRole("button", { name: /注册（押金/ })).toBeDisabled();
  });

  it("reveals World ID inputs when verified registration mode is selected", async () => {
    render(<AgentsPage />);

    await userEvent.click(screen.getByRole("checkbox", { name: /使用 World ID 人类验证注册/ }));
    expect(screen.getByLabelText("World ID nullifier（0x…64 位）")).toBeInTheDocument();
    expect(screen.getByLabelText("人类证明（hex）")).toBeInTheDocument();
  });

  it("warns unverified active subjects and offers the PoH upgrade path", async () => {
    mocks.activeSubject = true;
    mocks.pohVerified = false;
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("尚未完成人类验证");
    const bind = screen.getByRole("button", { name: "绑定 PoH（升级为已验证身份）" });
    expect(bind).toBeDisabled();

    await userEvent.type(screen.getByLabelText("绑定 nullifier（0x…）"), `0x${"ab".repeat(32)}`);
    expect(bind).toBeEnabled();

    await userEvent.click(bind);
    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "bindPoH" }),
    );
  });
});
