import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { address: "0x1111111111111111111111111111111111111111", chainId: 31337, isConnected: true },
  connectors: [
    { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" },
    { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" },
  ],
  connect: vi.fn(),
  connectAsync: vi.fn(async () => ({ accounts: ["0x1111111111111111111111111111111111111111"], chainId: 31337 })),
  writeContract: vi.fn(),
  refetchCount: vi.fn(),
  refetchList: vi.fn(),
  activeSubject: false,
  pohVerified: false,
  feedback: { current: { phase: "confirming", hash: `0x${"12".repeat(32)}` } as Record<string, unknown> },
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnectors: () => mocks.connectors,
  useConnections: () => [],
  useConnect: () => ({
    connect: mocks.connect,
    connectAsync: mocks.connectAsync,
    connectors: mocks.connectors,
    isPending: false,
  }),
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
  CHAIN_MODE: "anvil",
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

    expect(await screen.findByText(/Registration succeeded. New Agent ID: 7/)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.refetchCount).toHaveBeenCalled();
      expect(mocks.refetchList).toHaveBeenCalledOnce();
    });
  });

  it("opens the wallet chooser instead of reusing a previously picked wallet", async () => {
    mocks.account.isConnected = false;
    render(<AgentsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

    // 每次点击都必须先看到选择页，而不是静默连到上一次那个钱包。
    const dialog = await screen.findByRole("dialog", { name: "Connect a wallet" });
    expect(within(dialog).getByRole("button", { name: /Rabby/ })).toBeInTheDocument();

    // 未安装的一律走「获取」链接，不能被当成可连接项。
    expect(mocks.connectAsync).not.toHaveBeenCalled();
  });

  it("connects with the wallet the user picked, not a hardcoded connector", async () => {
    mocks.account.isConnected = false;
    render(<AgentsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect a wallet" });
    await userEvent.click(within(dialog).getByRole("button", { name: /MetaMask/ }));

    expect(mocks.connectAsync).toHaveBeenCalledWith({
      connector: expect.objectContaining({ id: "io.metamask" }),
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("submits the on-chain registrationDeposit without multiplying it", async () => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    await userEvent.type(screen.getByLabelText("Agent name (e.g. DataAgent)"), "DepositCheck");
    await userEvent.type(screen.getByLabelText("Capability description (e.g. on-chain data analysis)"), "Checks deposit");
    await userEvent.type(screen.getByLabelText("MCP/A2A endpoint (https://…)"), "https://agent.example");
    await userEvent.type(screen.getByLabelText("Guardian 1 (required)"), "0x2222222222222222222222222222222222222222");
    await userEvent.type(screen.getByLabelText("Guardian 2 (required)"), "0x3333333333333333333333333333333333333333");
    await userEvent.click(screen.getByRole("button", { name: /Register \(lock/ }));
    expect(mocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "registerAgent", value: 1n }));
  });

  it("blocks registration on the wrong chain", () => {
    mocks.account.chainId = 1;
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
    expect(screen.getByRole("button", { name: /Register \(lock/ })).toBeDisabled();
  });

  it("reveals World ID inputs when verified registration mode is selected", async () => {
    render(<AgentsPage />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Register with World ID Proof of Humanity/ }));
    expect(screen.getByLabelText("World ID nullifier (0x… 64 digits)")).toBeInTheDocument();
    expect(screen.getByLabelText("Humanity proof (hex)")).toBeInTheDocument();
  });

  it("warns unverified active subjects and offers the PoH upgrade path", async () => {
    mocks.activeSubject = true;
    mocks.pohVerified = false;
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Proof of Humanity");
    const bind = screen.getByRole("button", { name: "Bind PoH (upgrade to verified identity)" });
    expect(bind).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Bind nullifier (0x… 64 hex digits; any unused value on testnet)"), `0x${"ab".repeat(32)}`);
    expect(bind).toBeEnabled();

    await userEvent.click(bind);
    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "bindPoH" }),
    );
  });
});
