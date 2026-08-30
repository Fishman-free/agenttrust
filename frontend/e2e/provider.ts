import type { Page } from "@playwright/test";

export async function installAnvilProvider(page: Page) {
  await page.addInitScript(({ rpcUrl, requiredChainId }) => {
    const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let selectedAccount: string | undefined = window.sessionStorage.getItem("anvil-e2e-account") ?? undefined;
    let requestId = 0;
    let clockOffsetMs = 0;
    const realDateNow = Date.now.bind(Date);
    Date.now = () => realDateNow() + clockOffsetMs;

    function assertSafe() {
      if (!allowedHosts.has(window.location.hostname)) throw Object.assign(new Error("Anvil E2E provider refuses non-localhost pages"), { code: 4100 });
      const endpoint = new URL(rpcUrl);
      if (!allowedHosts.has(endpoint.hostname) || endpoint.port !== "8545" || requiredChainId !== 31337) {
        throw Object.assign(new Error("Anvil E2E provider refuses RPC endpoints other than localhost:8545 / chain 31337"), { code: 4901 });
      }
    }

    async function forward(method: string, params: unknown[] = []) {
      assertSafe();
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      });
      const payload = await response.json() as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      if (payload.error) throw Object.assign(new Error(payload.error.message), payload.error);
      return payload.result;
    }

    function emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    }

    const provider = {
      isMetaMask: true,
      isAnvilE2E: true,
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        assertSafe();
        if (method === "eth_chainId") return "0x7a69";
        if (method === "net_version") return String(requiredChainId);
        if (method === "eth_accounts") return selectedAccount ? [selectedAccount] : [];
        if (method === "wallet_getPermissions") return selectedAccount ? [{ parentCapability: "eth_accounts", caveats: [] }] : [];
        if (method === "wallet_requestPermissions") {
          if (!selectedAccount) selectedAccount = String((await forward("eth_accounts") as string[])[0]);
          window.sessionStorage.setItem("anvil-e2e-account", selectedAccount);
          return [{ parentCapability: "eth_accounts", caveats: [] }];
        }
        if (method === "eth_requestAccounts") {
          if (!selectedAccount) selectedAccount = String((await forward("eth_accounts") as string[])[0]);
          window.sessionStorage.setItem("anvil-e2e-account", selectedAccount);
          queueMicrotask(() => emit("connect", { chainId: "0x7a69" }));
          return [selectedAccount];
        }
        if (method === "wallet_switchEthereumChain") {
          const chainId = Number.parseInt(String((params[0] as { chainId?: string })?.chainId), 16);
          if (chainId !== requiredChainId) throw Object.assign(new Error("Only Anvil chain 31337 is available"), { code: 4902 });
          queueMicrotask(() => emit("chainChanged", "0x7a69"));
          return null;
        }
        if (method === "wallet_addEthereumChain") {
          const chainId = Number.parseInt(String((params[0] as { chainId?: string })?.chainId), 16);
          if (chainId !== requiredChainId) throw Object.assign(new Error("Only Anvil chain 31337 may be added"), { code: 4902 });
          return null;
        }
        if (method === "eth_sendTransaction") {
          const transaction = { ...(params[0] as Record<string, unknown>), from: selectedAccount };
          return forward(method, [transaction]);
        }
        return forward(method, params);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
        return provider;
      },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(listener);
        return provider;
      },
    };

    Object.defineProperty(window, "ethereum", { configurable: false, enumerable: true, value: provider });

    // EIP-6963：模拟钱包以 MetaMask 身份 announce，wagmi 的
    // multiInjectedProviderDiscovery 才能发现它，钱包选择页才会列出「MetaMask」。
    const providerInfo = Object.freeze({
      uuid: "0d7a6d10-3c4e-4f2a-9d1a-6a5b2e9c3f01",
      name: "MetaMask",
      icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><rect width='30' height='30' rx='6' fill='%23f5841f'/><text x='15' y='20' font-size='14' text-anchor='middle' fill='white'>M</text></svg>",
      rdns: "io.metamask",
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info: providerInfo, provider }),
    }));
    window.addEventListener("eip6963:requestProvider", announce);
    // 兜底：若页面脚本先于 mipd 运行，稍后再补发一次 announce。
    window.setTimeout(announce, 50);

    Object.defineProperty(window, "__anvilE2E", { configurable: false, value: {
      switchAccount: async (index: number) => {
        assertSafe();
        const accounts = await forward("eth_accounts") as string[];
        if (!Number.isInteger(index) || !accounts[index]) throw new Error(`Unknown Anvil account index ${index}`);
        selectedAccount = accounts[index];
        window.sessionStorage.setItem("anvil-e2e-account", selectedAccount);
        emit("accountsChanged", [selectedAccount]);
        return selectedAccount;
      },
      increaseTime: async (seconds: number) => {
        assertSafe();
        await forward("evm_increaseTime", [seconds]);
        await forward("evm_mine");
        clockOffsetMs += seconds * 1000;
        return clockOffsetMs;
      },
    }});
  }, { rpcUrl: "http://127.0.0.1:8545", requiredChainId: 31337 });
}

export async function switchAccount(page: Page, index: number) {
  return page.evaluate((target) => (window as unknown as { __anvilE2E: { switchAccount(index: number): Promise<string> } }).__anvilE2E.switchAccount(target), index);
}

export async function increaseTime(page: Page, seconds: number) {
  await page.evaluate((amount) => (window as unknown as { __anvilE2E: { increaseTime(seconds: number): Promise<number> } }).__anvilE2E.increaseTime(amount), seconds);
}
