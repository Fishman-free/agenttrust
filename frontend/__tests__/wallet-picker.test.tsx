import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { address: undefined as `0x${string}` | undefined, isConnected: false, connector: undefined as { id: string; name: string; rdns?: string } | undefined },
  connectors: [] as Array<{ id: string; name: string; rdns?: string }>,
  connectAsync: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnect: () => ({ connectAsync: mocks.connectAsync, isPending: false, error: null, reset: vi.fn() }),
  useConnectors: () => mocks.connectors,
  useDisconnect: () => ({ disconnect: mocks.disconnect }),
}));

vi.mock("wagmi/connectors", () => ({
  injected: (parameters: { target: { id: string; name: string } }) => ({ __injected: parameters.target }),
}));

import { WalletPickerProvider, useWalletPicker } from "@/app/components/wallet-picker";

function Trigger() {
  const picker = useWalletPicker();
  return (
    <>
      <button onClick={() => picker.open("connect")}>Connect wallet</button>
      <button onClick={() => picker.open("switch")}>Switch wallet</button>
    </>
  );
}

function renderHarness() {
  return render(
    <WalletPickerProvider>
      <Trigger />
    </WalletPickerProvider>,
  );
}

beforeEach(() => {
  mocks.account.address = undefined;
  mocks.account.isConnected = false;
  mocks.account.connector = undefined;
  mocks.connectors = [];
  vi.clearAllMocks();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).ethereum;
});

describe("WalletPicker", () => {
  it("lists detected wallets and connects with the EIP-6963 connector", async () => {
    mocks.connectors = [{ id: "io.metamask", name: "MetaMask", rdns: "io.metamask" }];
    renderHarness();

    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("MetaMask");

    await userEvent.click(screen.getByRole("button", { name: /MetaMask/ }));
    expect(mocks.connectAsync).toHaveBeenCalledWith({ connector: mocks.connectors[0] });
  });

  it("offers an install link for wallets that are not detected", async () => {
    renderHarness();
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

    const install = await screen.findByRole("link", { name: /MetaMask/ });
    expect(install).toHaveAttribute("href", "https://metamask.io/download/");
    expect(screen.getAllByText("Not detected").length).toBeGreaterThan(0);
  });

  it("reopens the picker when already connected and marks the current wallet", async () => {
    mocks.account.isConnected = true;
    mocks.account.address = "0x1111111111111111111111111111111111111111";
    mocks.account.connector = { id: "io.metamask", name: "MetaMask", rdns: "io.metamask" };
    mocks.connectors = [{ id: "io.metamask", name: "MetaMask", rdns: "io.metamask" }];
    renderHarness();

    await userEvent.click(screen.getByRole("button", { name: "Switch wallet" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Switch wallet");

    const current = screen.getByRole("button", { name: /MetaMask/ });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toBeDisabled();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    renderHarness();
    const trigger = screen.getByRole("button", { name: "Connect wallet" });
    await userEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("falls back to the legacy injected provider when EIP-6963 is unavailable", async () => {
    (window as unknown as Record<string, unknown>).ethereum = {
      request: () => Promise.resolve(),
      isRabby: true,
    };
    renderHarness();
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

    await userEvent.click(await screen.findByRole("button", { name: /Rabby/ }));
    expect(mocks.connectAsync).toHaveBeenCalledWith({
      connector: expect.objectContaining({ __injected: expect.objectContaining({ id: "rabby", name: "Rabby" }) }),
    });
  });
});
