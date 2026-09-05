import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: { address: "0x1111111111111111111111111111111111111111", chainId: 31337, isConnected: true, connector: { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" } },
  connectors: [
    { id: "io.metamask", name: "MetaMask", type: "injected", rdns: "io.metamask" },
    { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" },
  ],
  connect: vi.fn(),
  connectAsync: vi.fn(async () => ({ accounts: ["0x1111111111111111111111111111111111111111"], chainId: 31337 })),
  disconnectAsync: vi.fn(async () => {}),
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
  useDisconnect: () => ({ disconnect: vi.fn(), disconnectAsync: mocks.disconnectAsync }),
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
  mocks.account.connector = { id: "io.rabby", name: "Rabby", type: "injected", rdns: "io.rabby" };
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

  it.each([
    ["http://localhost:3000/mcp", "localhost over http"],
    ["https://localhost/mcp", "localhost over https"],
    ["https://127.0.0.1/mcp", "loopback IP"],
    ["https://192.168.1.10/mcp", "private LAN IP"],
    ["https://10.0.0.4/mcp", "private class-A IP"],
    ["https://my-agent.local/mcp", "mDNS host"],
    ["not-a-url", "not a URL at all"],
  ])("blocks registration for an endpoint nobody else can reach: %s (%s)", async (badEndpoint) => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    await userEvent.type(screen.getByLabelText("Agent name (e.g. DataAgent)"), "Unreachable");
    await userEvent.type(screen.getByLabelText("Capability description (e.g. on-chain data analysis)"), "Local only");
    await userEvent.type(screen.getByLabelText("MCP/A2A endpoint (https://…)"), badEndpoint);
    await userEvent.type(screen.getByLabelText("Guardian 1 (required)"), "0x2222222222222222222222222222222222222222");
    await userEvent.type(screen.getByLabelText("Guardian 2 (required)"), "0x3333333333333333333333333333333333333333");

    const register = screen.getByRole("button", { name: /Register \(lock/ });
    expect(register).toBeDisabled();
    expect(register.getAttribute("title")).toContain("public https://");
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it("accepts a public https endpoint and keeps the register button enabled", async () => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    await userEvent.type(screen.getByLabelText("Agent name (e.g. DataAgent)"), "Reachable");
    await userEvent.type(screen.getByLabelText("Capability description (e.g. on-chain data analysis)"), "Public agent");
    await userEvent.type(screen.getByLabelText("MCP/A2A endpoint (https://…)"), "https://agent.example.com/mcp");
    await userEvent.type(screen.getByLabelText("Guardian 1 (required)"), "0x2222222222222222222222222222222222222222");
    await userEvent.type(screen.getByLabelText("Guardian 2 (required)"), "0x3333333333333333333333333333333333333333");

    const register = screen.getByRole("button", { name: /Register \(lock/ });
    expect(register).toBeEnabled();
    await userEvent.click(register);
    expect(mocks.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "registerAgent", args: ["Reachable", "Public agent", "https://agent.example.com/mcp", expect.any(Array)] }),
    );
  });

  // 端点上链后没有 setter。临时隧道主机名每次重启都会变，写进链上等于铸造一个必然失效的身份，
  // 所以必须拦在表单里提醒 —— 但仍然允许注册，因为「先填一个临时地址试水」是合理场景。
  it.each([
    ["https://cheats-providence-ships-delaware.trycloudflare.com/mcp", "Cloudflare quick tunnel"],
    ["https://abc123.ngrok.io/mcp", "ngrok"],
    ["https://abc123.ngrok-free.app/mcp", "ngrok free"],
    ["https://foo.loca.lt/mcp", "localtunnel"],
    ["https://foo.serveo.net/mcp", "serveo"],
  ])("warns about a temporary tunnel address (%s) but still allows registering: %s", async (ephemeral) => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    await userEvent.type(screen.getByLabelText("Agent name (e.g. DataAgent)"), "TempTunnel");
    await userEvent.type(screen.getByLabelText("Capability description (e.g. on-chain data analysis)"), "Tunnel test");
    await userEvent.type(screen.getByLabelText("MCP/A2A endpoint (https://…)"), ephemeral);
    await userEvent.type(screen.getByLabelText("Guardian 1 (required)"), "0x2222222222222222222222222222222222222222");
    await userEvent.type(screen.getByLabelText("Guardian 2 (required)"), "0x3333333333333333333333333333333333333333");

    expect(screen.getByText(/looks like a temporary tunnel address/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Register \(lock/ })).toBeEnabled();
  });

  // 反例比正例更重要：只按后缀匹配，不能用 includes，否则这些「域名里提到隧道厂商
  // 但主机名其实稳定」的地址会被误报。
  it.each([
    ["https://mcp.example.com/mcp", "stable hostname"],
    ["https://mcp.trycloudflare.example.com/mcp", "hostname that merely mentions trycloudflare"],
    ["https://ngrok.io.example.com/mcp", "ngrok as a label of another domain"],
    // 这条最关键：后缀出现在中间而非结尾。用 includes 会误报，必须 endsWith 才正确 ——
    // attacker.com 的子域不是 Cloudflare 隧道，主机名其实是稳定的。
    ["https://foo.trycloudflare.com.attacker.com/mcp", "tunnel vendor as an inner label we do not control"],
  ])("does not warn about %s: %s", async (stable) => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    await userEvent.type(screen.getByLabelText("MCP/A2A endpoint (https://…)"), stable);
    expect(screen.queryByText(/temporary tunnel/)).toBeNull();
  });

  // 注册只登记地址，不探测、不要求匿名可访问。这条提示用来防止 owner 为了「过校验」
  // 把自家端点的鉴权关掉（真实事故：有人这么干，结果公网谁都能白嫖他的额度）。
  it("tells the owner the endpoint may keep its own auth", () => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);
    expect(screen.getByText(/does not require anonymous access/)).toBeTruthy();
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

  it("keeps a wallet switch entry on the page once connected", async () => {
    mocks.activeSubject = false;
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    // 回归：旧版只在未连接时渲染连接按钮，连上之后这一页就没有任何换钱包的入口，
    // 唯一入口藏在页头头像菜单里。页内必须常驻一个。
    await userEvent.click(screen.getByRole("button", { name: "Switch wallet" }));

    const dialog = await screen.findByRole("dialog", { name: "Connect a wallet" });
    expect(within(dialog).getByRole("button", { name: /MetaMask/ })).toBeInTheDocument();
  });

  it("names the wallet currently in use next to the switch entry", () => {
    mocks.feedback.current = { phase: "idle" };
    render(<AgentsPage />);

    expect(screen.getByText("Wallet in use")).toBeInTheDocument();
    expect(screen.getByText("Rabby · 0x1111…1111")).toBeInTheDocument();
  });

  it("keeps the ambient background outside the animated .page box", () => {
    const { container } = render(<AgentsPage />);

    const page = container.querySelector("main.page");
    const ambient = container.querySelector(".ambient-bg");
    expect(page).not.toBeNull();
    expect(ambient).not.toBeNull();

    // 回归防线：.page 带 page-enter 入场动画，末帧 transform 因 fill-mode:both 保留下来，
    // 会把内部 position:fixed 的包含块拽成 .page 自身（46rem 窄框），背景只剩中间一条。
    // 背景必须当 .page 的兄弟节点，而不是塞在它里面。
    expect(container.querySelector(".page .ambient-bg")).toBeNull();
    expect(ambient?.parentElement).toBe(page?.parentElement);
  });
});
