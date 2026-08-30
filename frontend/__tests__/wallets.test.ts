import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WALLET_BRANDS,
  WALLET_PREFERENCE_KEY,
  buildWalletOptions,
  findWalletOption,
  readPreferredWallet,
  rememberPreferredWallet,
  type DetectedConnector,
} from "@/lib/wallets";

const connector = (id: string, name = id, extra: Partial<DetectedConnector> = {}): DetectedConnector =>
  ({ id, name, type: "injected", rdns: id, ...extra });

describe("buildWalletOptions", () => {
  it("puts detected curated wallets first, in curated order", () => {
    const options = buildWalletOptions([
      connector("io.metamask", "MetaMask"),
      connector("io.rabby", "Rabby"),
    ]);

    // 策展顺序优先于发现顺序：即便 MetaMask 先 announce，Rabby 仍排在前面。
    expect(options.slice(0, 2).map((option) => option.rdns)).toEqual(["io.rabby", "io.metamask"]);
    expect(options.slice(0, 2).every((option) => option.detected)).toBe(true);
  });

  it("keeps undetected curated wallets as install entries after the detected ones", () => {
    const options = buildWalletOptions([connector("io.rabby", "Rabby")]);

    const detected = options.filter((option) => option.detected);
    const installable = options.filter((option) => !option.detected);
    expect(detected.map((option) => option.rdns)).toEqual(["io.rabby"]);
    expect(installable.map((option) => option.rdns)).toEqual(WALLET_BRANDS.slice(1).map((brand) => brand.rdns));
    expect(installable.every((option) => option.connector === undefined && Boolean(option.installUrl))).toBe(true);
  });

  it("does not drop wallets that are installed but not in the curated list", () => {
    const options = buildWalletOptions([
      connector("io.rabby", "Rabby"),
      connector("com.unknown.wallet", "Mystery Wallet"),
    ]);

    const mystery = options.find((option) => option.rdns === "com.unknown.wallet");
    expect(mystery?.detected).toBe(true);
    expect(mystery?.name).toBe("Mystery Wallet");
    // 通用钱包排在策展已检测之后、未安装之前。
    expect(options.indexOf(mystery!)).toBe(1);
  });

  it("matches connectors by rdns arrays, not just the primary id", () => {
    const options = buildWalletOptions([
      { id: "metaMask", name: "MetaMask", type: "injected", rdns: ["io.metamask", "io.metamask.mobile"] },
    ]);

    const metamask = options.find((option) => option.rdns === "io.metamask");
    expect(metamask?.detected).toBe(true);
  });

  it("produces stable keys with no duplicates", () => {
    const options = buildWalletOptions([
      connector("io.rabby", "Rabby"),
      connector("io.metamask", "MetaMask"),
    ]);
    expect(new Set(options.map((option) => option.key)).size).toBe(options.length);
  });

  it("ignores mock connectors used by tests", () => {
    const options = buildWalletOptions([
      { id: "mock", name: "Mock", type: "mock" } as DetectedConnector,
      connector("io.rabby", "Rabby"),
    ]);
    expect(options.some((option) => option.rdns === "mock")).toBe(false);
  });

  it("hides the bare injected fallback connector when real wallets are detected", () => {
    const options = buildWalletOptions([
      { id: "injected", name: "Injected", type: "injected" } as DetectedConnector,
      connector("io.rabby", "Rabby"),
    ]);

    expect(options.some((option) => option.rdns === "io.rabby")).toBe(true);
    expect(options.some((option) => option.rdns === "injected")).toBe(false);
  });
});

describe("findWalletOption", () => {
  it("resolves only detected wallets by rdns", () => {
    const options = buildWalletOptions([connector("io.rabby", "Rabby")]);
    expect(findWalletOption(options, "io.rabby")?.detected).toBe(true);
    expect(findWalletOption(options, "io.metamask")).toBeUndefined();
    expect(findWalletOption(options, undefined)).toBeUndefined();
  });
});

describe("preferred wallet memory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("remembers the wallet the user picked so the next visit can surface it", () => {
    expect(readPreferredWallet()).toBeUndefined();
    rememberPreferredWallet("io.rabby");
    expect(window.localStorage.getItem(WALLET_PREFERENCE_KEY)).toBe("io.rabby");
    expect(readPreferredWallet()).toBe("io.rabby");
  });

  it("returns undefined when storage is unavailable instead of throwing", () => {
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPreferredWallet()).toBeUndefined();
    getItem.mockRestore();
  });
});
