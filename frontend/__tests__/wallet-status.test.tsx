import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WalletState, type WalletStateProps } from "@/app/components/wallet-status";

const baseProps: WalletStateProps = {
  expectedChainId: 84532,
  expectedChainName: "Base Sepolia",
  isConnected: false,
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onSwitchChain: vi.fn(),
};

describe("WalletState", () => {
  it("connects from the disconnected state", async () => {
    const onConnect = vi.fn();
    render(<WalletState {...baseProps} onConnect={onConnect} />);

    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("shows the account and allows disconnecting", async () => {
    const onDisconnect = vi.fn();
    render(
      <WalletState
        {...baseProps}
        address="0x1234567890abcdef1234567890abcdef12345678"
        chainId={84532}
        chainName="Base Sepolia"
        isConnected
        onDisconnect={onDisconnect}
      />,
    );

    expect(screen.getByText("0x1234…5678")).toBeInTheDocument();
    expect(screen.getByText("Base Sepolia")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("detects a wrong network and offers switch/add chain", async () => {
    const onSwitchChain = vi.fn();
    render(
      <WalletState
        {...baseProps}
        address="0x1234567890abcdef1234567890abcdef12345678"
        chainId={1}
        chainName="Ethereum"
        isConnected
        onSwitchChain={onSwitchChain}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
    await userEvent.click(screen.getByRole("button", { name: /Switch\/add Base Sepolia/ }));
    expect(onSwitchChain).toHaveBeenCalledOnce();
  });
});
