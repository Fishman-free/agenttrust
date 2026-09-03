import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const ADDRESS = "0x1111111111111111111111111111111111111111";
  return {
    ADDRESS,
    OTHER: "0x2222222222222222222222222222222222222222",
    account: { address: ADDRESS, chainId: 31337, isConnected: true, connector: { name: "Rabby" } },
  disconnect: vi.fn(),
  switchChain: vi.fn(),
  connectAsync: vi.fn(async () => ({ accounts: [ADDRESS], chainId: 31337 })),
  writeContract: vi.fn(),
  connectors: [{ id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" }],
    reads: {
      deposits: 10n ** 18n,
      pendingWithdrawals: 0n,
      activeSubjects: ADDRESS as string | false,
      deregistered: false,
      recoveryRequests: undefined,
      subjectHasActiveTrades: false,
      subjectHasOpenCommitments: false,
    } as Record<string, unknown>,
    connections: [] as Array<{ connector: { id: string }; accounts: string[] }>,
  };
});

const { ADDRESS, OTHER } = mocks;

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnect: () => ({ connectAsync: mocks.connectAsync, isPending: false }),
  useConnectors: () => mocks.connectors,
  useConnections: () => mocks.connections,
  useDisconnect: () => ({ disconnect: mocks.disconnect }),
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false }),
  useWaitForTransactionReceipt: () => ({ data: undefined, error: null, isSuccess: false }),
  useWriteContract: () => ({
    data: undefined,
    writeContract: mocks.writeContract,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data: mocks.reads[functionName],
    refetch: vi.fn(async () => ({ data: mocks.reads[functionName] })),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/lib/config", () => ({
  CHAIN_ID: 31337,
  CHAIN_MODE: "anvil",
  CONTRACT_ADDRESSES: {
    agentRegistry: "0x3333333333333333333333333333333333333333",
    guaranteeEscrow: "0x4444444444444444444444444444444444444444",
    schellingVoting: "0x5555555555555555555555555555555555555555",
  },
  WRITES_ENABLED: true,
  WRITE_BLOCK_REASON: undefined,
  activeChain: { id: 31337, name: "Anvil" },
  isZeroAddress: () => false,
  getWriteBlockReason: () => undefined,
}));

import { AccountMenu } from "@/app/components/account-menu";
import { TxHistoryProvider } from "@/lib/tx-history";
import { TX_HISTORY_KEY, type TxRecord } from "@/lib/tx-history";

function record(overrides: Partial<TxRecord>): TxRecord {
  return {
    id: "0xabc",
    hash: "0xabc",
    kind: "trade",
    label: "Create trade",
    status: "success",
    subject: ADDRESS.toLowerCase(),
    chainId: 31337,
    timestamp: Date.UTC(2026, 0, 2, 3, 4),
    ...overrides,
  };
}

function renderMenu() {
  return render(<TxHistoryProvider><AccountMenu /></TxHistoryProvider>);
}

async function openMenu() {
  renderMenu();
  await userEvent.click(screen.getByRole("button", { name: "Open account menu" }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.account.address = ADDRESS;
  mocks.account.chainId = 31337;
  mocks.account.isConnected = true;
  mocks.account.connector = { name: "Rabby" };
  mocks.reads = {
    deposits: 10n ** 18n,
    pendingWithdrawals: 0n,
    activeSubjects: ADDRESS,
    deregistered: false,
    recoveryRequests: undefined,
    subjectHasActiveTrades: false,
    subjectHasOpenCommitments: false,
  };
  vi.clearAllMocks();
});

describe("AccountMenu", () => {
  it("offers a connect button while disconnected", async () => {
    mocks.account.isConnected = false;
    renderMenu();

    const button = screen.getByRole("button", { name: "Connect wallet" });
    await userEvent.click(button);

    // 未连接时也必须走选择页，而不是静默复用旧连接。
    expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
  });

  it("opens the account menu with the connected account", async () => {
    const menu = await openMenu();

    // 地址同时出现在头部与「修改昵称」的当前值提示里，因此按复制按钮断言。
    expect(within(menu).getByRole("button", { name: "Copy address" })).toHaveTextContent("0x1111…1111");
    expect(within(menu).getByRole("menuitem", { name: /Edit nickname/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Transactions/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Deregister account & redeem deposit/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Disconnect/ })).toBeInTheDocument();
  });

  it("shows the locked deposit and withdrawable balance", async () => {
    mocks.reads.pendingWithdrawals = 5n * 10n ** 17n;
    const menu = await openMenu();
    expect(within(menu).getByText("1 ETH")).toBeInTheDocument();
    expect(within(menu).getByText("0.5 ETH")).toBeInTheDocument();
  });

  it("reopens the network guide from the menu when the wallet is on the wrong chain", async () => {
    mocks.account.chainId = 1;
    const menu = await openMenu();

    // 弹窗被关掉之后，账户菜单里的告警仍是回到指引的入口。
    await userEvent.click(within(menu).getByRole("button", { name: "Show me the steps" }));
    expect(await screen.findByRole("heading", { name: "Switch Rabby to Anvil" })).toBeInTheDocument();
  });

  it("renames the account and scopes the nickname to that address", async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Edit nickname/ }));

    // 视图切换带退场动画，需等待新视图挂载。
    await userEvent.type(await screen.findByLabelText("Nickname"), "Trading Bot");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open account menu" })).toHaveTextContent("Trading Bot");
    });
    expect(JSON.parse(window.localStorage.getItem("agenttrust.nicknames") ?? "{}")).toEqual({
      [ADDRESS.toLowerCase()]: "Trading Bot",
    });

    // 换一个账户后不应继承上一个账户的昵称（同一测试内第二次渲染需按容器限定范围）。
    mocks.account.address = OTHER;
    const second = renderMenu();
    await waitFor(() => {
      expect(within(second.container).getByRole("button", { name: "Open account menu" })).toHaveTextContent("0x2222…2222");
    });
  });

  it("clears the nickname when the field is emptied", async () => {
    window.localStorage.setItem("agenttrust.nicknames", JSON.stringify({ [ADDRESS.toLowerCase()]: "Old name" }));
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Edit nickname/ }));

    const input = await screen.findByLabelText("Nickname");
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("agenttrust.nicknames") ?? "{}")).toEqual({});
    });
  });

  it("lists only the connected account's transactions", async () => {
    window.localStorage.setItem(TX_HISTORY_KEY, JSON.stringify({
      version: 1,
      records: [
        record({ id: "0xmine", hash: "0xmine", label: "Create trade" }),
        record({ id: "0xtheirs", hash: "0xtheirs", label: "Someone else", subject: OTHER.toLowerCase() }),
      ],
    }));

    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Transactions/ }));

    expect(await screen.findByText("Create trade")).toBeInTheDocument();
    expect(screen.queryByText("Someone else")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no local transactions", async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Transactions/ }));

    expect(await screen.findByText(/No transactions from this account/)).toBeInTheDocument();
  });

  it("blocks deregistration while the account has unsettled trades", async () => {
    mocks.reads.subjectHasActiveTrades = true;

    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Deregister account & redeem deposit/ }));

    expect(await screen.findByText(/unsettled trades/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deregister account & redeem deposit" })).toBeDisabled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("requires an explicit second confirm, then submits deregister", async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Deregister account & redeem deposit/ }));

    const deregister = await screen.findByRole("button", { name: "Deregister account & redeem deposit" });
    expect(deregister).toBeEnabled();
    await userEvent.click(deregister);

    // 破坏性操作必须显式二次确认，不能一键注销。
    const confirm = await screen.findByRole("button", { name: "I understand, deregister" });
    await userEvent.click(confirm);

    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "deregister" }),
    );
  });

  it("offers the deposit redemption once the identity is deregistered", async () => {
    mocks.reads.deregistered = true;
    mocks.reads.pendingWithdrawals = 10n ** 18n;

    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Deregister account & redeem deposit/ }));

    const redeem = await screen.findByRole("button", { name: "Redeem deposit" });
    await userEvent.click(redeem);

    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "withdraw", args: [ADDRESS] }),
    );
  });

  it("warns and offers a network switch when the wallet is on the wrong chain", async () => {
    mocks.account.chainId = 1;
    const menu = await openMenu();

    expect(within(menu).getByRole("alert")).toHaveTextContent("Network error");
    await userEvent.click(within(menu).getByRole("button", { name: /Switch\/add Anvil/ }));
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 31337 });
  });

  it("disconnects the wallet from the menu", async () => {
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Disconnect/ }));
    expect(mocks.disconnect).toHaveBeenCalled();
  });
});
