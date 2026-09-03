import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectors: [
    { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" },
    { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" },
  ],
  connectAsync: vi.fn(async () => ({ accounts: ["0x1111111111111111111111111111111111111111"], chainId: 31337 })),
  connections: [] as Array<{ connector: { id: string }; accounts: string[] }>,
  activeConnector: undefined as { id: string } | undefined,
  disconnectAsync: vi.fn(async () => {}),
}));

vi.mock("wagmi", () => ({
  useConnectors: () => mocks.connectors,
  useConnections: () => mocks.connections,
  useConnect: () => ({ connectAsync: mocks.connectAsync, isPending: false }),
  useAccount: () => ({ connector: mocks.activeConnector }),
  useDisconnect: () => ({ disconnectAsync: mocks.disconnectAsync }),
}));

import { WalletPicker } from "@/app/components/wallet-picker";
import { WALLET_PREFERENCE_KEY, readPreferredWallet } from "@/lib/wallets";

async function openPicker(onClose = vi.fn(), onConnected?: () => void | boolean) {
  const view = render(<WalletPicker open onClose={onClose} onConnected={onConnected} />);
  const dialog = await screen.findByRole("dialog");
  return { view, dialog, onClose };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.connectors = [
    { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" },
    { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" },
  ];
  mocks.connections = [];
  mocks.activeConnector = undefined;
  mocks.connectAsync.mockResolvedValue({ accounts: ["0x1111111111111111111111111111111111111111"], chainId: 31337 });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WalletPicker", () => {
  it("renders nothing while closed", () => {
    render(<WalletPicker open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every detected wallet plus install entries for the missing ones", async () => {
    await openPicker();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Rabby/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /MetaMask/ })).toBeInTheDocument();
    // 未安装的仍然列出，方便用户去获取，但标记为「未安装」。
    expect(within(dialog).getAllByText("Not installed").length).toBeGreaterThan(0);
  });

  it("connects with the wallet the user picked and remembers it", async () => {
    const onClose = vi.fn();
    await openPicker(onClose);

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /MetaMask/ }));

    await waitFor(() => {
      expect(mocks.connectAsync).toHaveBeenCalledWith({
        connector: expect.objectContaining({ id: "io.metamask" }),
      });
    });
    expect(readPreferredWallet()).toBe("io.metamask");
    expect(window.localStorage.getItem(WALLET_PREFERENCE_KEY)).toBe("io.metamask");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("marks the wallet used last time", async () => {
    window.localStorage.setItem(WALLET_PREFERENCE_KEY, "io.rabby");
    const { dialog } = await openPicker();

    expect(within(dialog).getByText("Last used")).toBeInTheDocument();
  });

  it("sends undetected wallets to their install page instead of trying to connect", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { dialog } = await openPicker();

    const coinbase = within(dialog).getByRole("button", { name: /Coinbase Wallet/ });
    await userEvent.click(coinbase);

    expect(open).toHaveBeenCalledWith("https://www.coinbase.com/wallet", "_blank", "noopener,noreferrer");
    expect(mocks.connectAsync).not.toHaveBeenCalled();
  });

  it("surfaces a connection error and stays open so the user can retry", async () => {
    mocks.connectAsync.mockRejectedValue(new Error("User rejected the request"));
    const onClose = vi.fn();
    await openPicker(onClose);

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Rabby/ }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("User rejected the request");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers the window.ethereum fallback when no EIP-6963 wallet announces", async () => {
    // 配置里声明的无 target injected 兜底连接器：rdns 与 id 均为 "injected"。
    const bareInjected = { id: "injected", name: "Injected", type: "injected", rdns: "injected" };
    mocks.connectors = [bareInjected];
    render(<WalletPicker open onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    // 选择页不会直接显示裸露的「Injected」，而是以「浏览器钱包」兜底呈现。
    const row = within(dialog).getByRole("button", { name: /Browser wallet/ });
    await userEvent.click(row);

    await waitFor(() => {
      expect(mocks.connectAsync).toHaveBeenCalledWith({ connector: expect.objectContaining({ id: "injected" }) });
    });
  });

  it("switches back to a wallet that was connected before but is not the active one", async () => {
    // 回归：connections 里存的是**所有**已建立过的连接，current 只指向其中一个。
    // 旧版只要能找到就直接 return，于是「Rabby → MetaMask → 想切回 Rabby」是无声的无效点击。
    const metaMask = { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" };
    const rabby = { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" };
    mocks.connectors = [metaMask, rabby];
    mocks.activeConnector = rabby;              // 当前正在用 Rabby
    mocks.connections = [{ connector: metaMask, accounts: ["0x2222222222222222222222222222222222222222"] }];
    await openPicker(vi.fn());

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /MetaMask/ }));

    await waitFor(() => {
      expect(mocks.connectAsync).toHaveBeenCalledWith({
        connector: expect.objectContaining({ id: "io.metamask" }),
      });
    });
    // 不是当前连接，不需要先断开。
    expect(mocks.disconnectAsync).not.toHaveBeenCalled();
  });

  it("reconnects the wallet already in use so it re-asks which account to use", async () => {
    const metaMask = { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" };
    const rabby = { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" };
    mocks.connectors = [metaMask, rabby];
    mocks.activeConnector = metaMask;
    mocks.connections = [{ connector: metaMask, accounts: ["0x1111111111111111111111111111111111111111"] }];
    const { dialog } = await openPicker(vi.fn());

    // 正在用的钱包要能被认出来。
    expect(within(dialog).getByText("Connected")).toBeInTheDocument();
    expect(within(dialog).getByText("In use · click to pick another account")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /MetaMask/ }));

    // 只有目标**就是**当前连接时 wagmi 才会抛 ConnectorAlreadyConnectedError，
    // 所以必须先断开再连，让钱包插件重新弹出账户选择；不能静默关掉弹层。
    await waitFor(() => {
      expect(mocks.disconnectAsync).toHaveBeenCalledWith({
        connector: expect.objectContaining({ id: "io.metamask" }),
      });
    });
    expect(mocks.connectAsync).toHaveBeenCalledWith({
      connector: expect.objectContaining({ id: "io.metamask" }),
    });
    // 先断后连，顺序不能反。
    expect(mocks.disconnectAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.connectAsync.mock.invocationCallOrder[0],
    );
  });

  it("closes on Escape and moves focus to the first wallet row", async () => {
    const onClose = vi.fn();
    const { dialog } = await openPicker(onClose);

    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-wallet-row");
    });

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus between wallet rows with the arrow keys", async () => {
    const { dialog } = await openPicker();

    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-wallet-row"));
    const first = document.activeElement as HTMLElement;
    const rows = within(dialog).getAllByRole("button");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(first);
    expect(rows).toContain(document.activeElement);
  });
});
