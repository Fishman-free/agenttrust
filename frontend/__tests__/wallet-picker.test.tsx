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
}));

vi.mock("wagmi", () => ({
  useConnectors: () => mocks.connectors,
  useConnections: () => mocks.connections,
  useConnect: () => ({ connectAsync: mocks.connectAsync, isPending: false }),
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

  it("reuses the existing connection when the picked wallet is already connected", async () => {
    mocks.connections = [{ connector: { id: "io.metamask" }, accounts: ["0x1111111111111111111111111111111111111111"] }];
    const onConnected = vi.fn();
    await openPicker(vi.fn(), onConnected);

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /MetaMask/ }));

    // 不应调用 connectAsync（会抛「Connector already connected」），直接复用现有连接。
    expect(mocks.connectAsync).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        rdns: "io.metamask",
        address: "0x1111111111111111111111111111111111111111",
      });
    });
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
