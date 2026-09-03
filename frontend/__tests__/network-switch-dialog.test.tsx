import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const mocks = vi.hoisted(() => ({
  account: {
    address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    chainId: 1,
    isConnected: true,
    connector: { name: "Rabby" },
  },
  switchChain: vi.fn(),
  reset: vi.fn(),
  error: null as unknown,
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false, error: mocks.error, reset: mocks.reset }),
}));

vi.mock("@/lib/config", () => ({
  CHAIN_ID: 31337,
  CHAIN_MODE: "anvil",
  CONTRACT_ADDRESSES: {},
  WRITES_ENABLED: true,
  WRITE_BLOCK_REASON: undefined,
  activeChain: { id: 31337, name: "Anvil" },
  isZeroAddress: () => false,
  getWriteBlockReason: () => undefined,
}));

import { NetworkSwitchDialog, NetworkSwitchGate, type NetworkSwitchDialogProps } from "@/app/components/network-switch-dialog";

const base: NetworkSwitchDialogProps = {
  open: true,
  currentChainId: 1,
  expectedChainId: 84532,
  expectedChainName: "Base Sepolia",
  walletName: "Rabby",
  onSwitch: vi.fn(),
  onDismiss: vi.fn(),
};

beforeEach(() => {
  mocks.account = { address: ADDRESS, chainId: 1, isConnected: true, connector: { name: "Rabby" } };
  mocks.error = null;
  vi.clearAllMocks();
});

describe("NetworkSwitchDialog", () => {
  it("renders nothing while closed", () => {
    render(<NetworkSwitchDialog {...base} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the wallet to fix and the chain to switch to", async () => {
    render(<NetworkSwitchDialog {...base} />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Switch Rabby to Base Sepolia" })).toBeInTheDocument();
    // 当前链给出可读名字而不只是 Chain ID，用户才知道自己错在哪。
    expect(within(dialog).getByText("Ethereum Mainnet · 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Base Sepolia · 84532")).toBeInTheDocument();
  });

  it("lists the manual steps and offers the one-tap switch", async () => {
    const onSwitch = vi.fn();
    render(<NetworkSwitchDialog {...base} onSwitch={onSwitch} />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);
    expect(within(dialog).getByText(/Search for Base Sepolia and select it/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Switch/add Base Sepolia" }));
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("closes on the dismiss button and on Escape", async () => {
    const onDismiss = vi.fn();
    render(<NetworkSwitchDialog {...base} onDismiss={onDismiss} />);

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalledOnce();

    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe("NetworkSwitchGate", () => {
  it("pops up while the wallet sits on another chain", async () => {
    render(<NetworkSwitchGate />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Switch Rabby to Anvil" })).toBeInTheDocument();
  });

  it("stays quiet on the configured chain", () => {
    mocks.account.chainId = 31337;
    render(<NetworkSwitchGate />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks the wallet to switch and closes after the user dismisses it", async () => {
    render(<NetworkSwitchGate />);
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Switch/add Anvil" }));
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 31337 });

    await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("re-opens when the wallet lands on a different wrong chain", async () => {
    const view = render(<NetworkSwitchGate />);
    const first = await screen.findByRole("dialog");
    await userEvent.click(within(first).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // 换到另一个错误链：这是一个新的错误组合，指引必须重新出现。
    mocks.account = { ...mocks.account, chainId: 137 };
    view.rerender(<NetworkSwitchGate />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to a generic wording when the connector has no usable name", async () => {
    mocks.account = { ...mocks.account, connector: { name: "Injected" } };
    render(<NetworkSwitchGate />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Switch your wallet to Anvil" })).toBeInTheDocument();
  });

  it("shows the manual fallback when the wallet rejects the switch", async () => {
    mocks.error = new Error("User rejected the request.");
    render(<NetworkSwitchGate />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Rabby rejected the switch");
    expect(within(dialog).getByText(/Add Anvil \(Chain ID 31337\) manually/)).toBeInTheDocument();
  });
});
