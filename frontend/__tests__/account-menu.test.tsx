import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ACCOUNT: "0x1111111111111111111111111111111111111111",
  account: { address: "0x1111111111111111111111111111111111111111" as `0x${string}` | undefined, chainId: 31337, isConnected: true, connector: { id: "io.metamask", name: "MetaMask" } },
  disconnect: vi.fn(),
  switchChain: vi.fn(),
  openPicker: vi.fn(),
  writeContractAsync: vi.fn(),
  activeSubject: true,
  pendingWithdrawal: BigInt(0),
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useConnect: () => ({ connect: vi.fn(), connectAsync: vi.fn(), connectors: [], isPending: false, error: null, reset: vi.fn() }),
  useConnectors: () => [],
  useDisconnect: () => ({ disconnect: mocks.disconnect }),
  useSwitchChain: () => ({ switchChain: mocks.switchChain, isPending: false, error: null }),
  useWriteContract: () => ({ data: undefined, writeContract: vi.fn(), writeContractAsync: mocks.writeContractAsync, isPending: false, error: null }),
  useReadContract: ({ functionName }: { functionName: string }) => {
    if (functionName === "registrationDeposit") return { data: BigInt(1), refetch: vi.fn() };
    if (functionName === "activeSubjects") return { data: mocks.activeSubject, refetch: vi.fn() };
    if (functionName === "pendingWithdrawals") return { data: mocks.pendingWithdrawal, refetch: vi.fn() };
    if (functionName === "isPoHVerified") return { data: true, refetch: vi.fn() };
    return { data: BigInt(0), refetch: vi.fn() };
  },
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isError: false, isLoading: false, data: undefined }),
}));

vi.mock("@/app/components/wallet-picker", () => ({
  useWalletPicker: () => ({ open: mocks.openPicker, close: vi.fn(), isOpen: false }),
  WalletPickerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { AccountMenu } from "@/app/components/account-menu";
import { ProfileProvider } from "@/lib/profile";
import { TxHistoryProvider } from "@/lib/tx-history";

const ACCOUNT = "0x1111111111111111111111111111111111111111";

function renderMenu() {
  return render(
    <TxHistoryProvider>
      <ProfileProvider>
        <AccountMenu />
      </ProfileProvider>
    </TxHistoryProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.account.address = ACCOUNT;
  mocks.account.isConnected = true;
  mocks.account.chainId = 31337;
  mocks.activeSubject = true;
  mocks.pendingWithdrawal = BigInt(0);
  vi.clearAllMocks();
});

describe("AccountMenu", () => {
  it("shows a connect button that opens the wallet picker while disconnected", async () => {
    mocks.account.isConnected = false;
    mocks.account.address = undefined;
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(mocks.openPicker).toHaveBeenCalledWith("connect");
  });

  it("opens the account panel from the avatar button", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: /Account settings/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Account" });
    expect(dialog).toHaveTextContent("Profile");
    expect(dialog).toHaveTextContent("Switch account");
    expect(dialog).toHaveTextContent("Close identity");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("navigates into the transactions panel and back", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));

    await userEvent.click(await screen.findByRole("button", { name: /^Transactions/ }));
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: /^Profile/ })).toBeInTheDocument();
  });

  it("saves a nickname for the connected account only", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Profile/ }));

    const input = await screen.findByLabelText("Nickname");
    await userEvent.type(input, "Trading Bot");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem("agenttrust.profiles") ?? "{}");
      expect(stored[ACCOUNT.toLowerCase()]).toMatchObject({ nickname: "Trading Bot" });
    });
  });

  it("routes switch-account through the wallet picker", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Switch account/ }));

    expect(mocks.openPicker).toHaveBeenCalledWith("switch");
  });

  it("closes the identity and then reclaims the deposit", async () => {
    mocks.writeContractAsync.mockResolvedValue(`0x${"56".repeat(32)}`);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Close identity/ }));

    const deregister = await screen.findByRole("button", { name: "Deregister" });
    await userEvent.click(deregister);
    expect(mocks.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "deregister" }),
    );
  });

  it("disconnects the wallet from the embedded wallet section", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Account settings/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
