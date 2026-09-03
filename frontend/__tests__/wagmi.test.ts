import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 这几条测试守护的是首屏 hydration 正确性，不是 wagmi 的用法细节。
 *
 * 站点是静态导出（output: "export"），HTML 在构建期生成，那时没有钱包连接。
 * 如果 wagmi 在模块求值时就把 localStorage 里的上次连接读回 store，
 * 首帧 useAccount() 就会返回地址，与构建期 HTML 不一致 → React #418。
 *
 * 因此 ssr: true（等价于 persist 的 skipHydration）必须保持开启：
 * 恢复连接被推迟到 useEffect，也就是 hydration 完成之后。
 */

// wagmi 持久化 key：createStorage 前缀 "wagmi" + persist name "store"。
const STORE_KEY = "wagmi.store";

const ADDRESS = "0x1111111111111111111111111111111111111111";

// 这是仓库里第一个在 jsdom 中真实 import wagmi 的用例（其余用例都 vi.mock 掉了），
// 首次转换 wagmi + viem 的 ESM 图比较慢，给足超时。
const IMPORT_TIMEOUT = 60_000;

/**
 * 造一份「上次已连接 Rabby」的持久化快照。
 * version 必须匹配 @wagmi/core 的大版本，否则 persist 的 migrate 会把快照重置成初始状态，
 * 测试就会因为「种子数据是垃圾」而假通过。这里从包版本推导，升级依赖不会误报。
 */
async function seedPersistedConnection() {
  const { version } = await import("wagmi");
  const snapshot = {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "io.rabby",
            {
              accounts: [ADDRESS],
              chainId: 1,
              connector: { id: "injected", name: "Rabby", type: "injected", uid: "rabby-uid" },
            },
          ],
        ],
      },
      chainId: 1,
      current: "io.rabby",
    },
    version: Number.parseInt(version, 10),
  };
  window.localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
}

// zustand persist 的 API 没有完整外泄到 Config 类型上，这里收窄成一个最小结构。
type PersistApi = {
  hasHydrated: () => boolean;
  rehydrate: () => Promise<void> | void;
};

function persistApi(store: unknown): PersistApi {
  return (store as { persist: PersistApi }).persist;
}

describe("wagmi config hydration guard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it(
    "does not restore a persisted wallet synchronously while the module loads",
    async () => {
      await seedPersistedConnection();

      // 关键：模块求值就是首帧渲染前发生的事情，此时绝不能已经读盘。
      // hasHydrated() 是真正的鉴别信号——ssr:false 下 persist 会在这一刻就完成水合，返回 true。
      // （storage 的 getItem 是 async，所以水合是在 import 后的微任务里完成的，
      //    await import(...) 返回时若已水合，就说明首帧渲染前状态已经变了。）
      const { wagmiConfig } = await import("@/lib/wagmi");

      expect(persistApi(wagmiConfig._internal.store).hasHydrated()).toBe(false);
      expect(wagmiConfig.state.connections.size).toBe(0);
      expect(wagmiConfig.state.current).toBeNull();
    },
    IMPORT_TIMEOUT,
  );

  it(
    "still restores the same connection once hydration is triggered after mount",
    async () => {
      const { wagmiConfig } = await import("@/lib/wagmi");
      const persist = persistApi(wagmiConfig._internal.store);

      // 种子必须在 import 之后埋：createConfig 结尾有一句 store.setState(getInitialState())，
      // 它会把初始状态写回 localStorage，import 之前埋的种子会被这次写入冲掉。
      await seedPersistedConnection();

      // 反证：种子数据本身合法、rehydrate 也确实生效，
      // 上一条测试的「0 连接」不是因为塞了垃圾数据或存储不可用。
      await persist.rehydrate();

      expect(persist.hasHydrated()).toBe(true);
      expect(wagmiConfig.state.connections.size).toBe(1);
      expect(wagmiConfig.state.current).toBe("io.rabby");
    },
    IMPORT_TIMEOUT,
  );

  it(
    "keeps the reconnect-on-mount behaviour for returning users",
    async () => {
      const { wagmiConfig } = await import("@/lib/wagmi");
      // ssr: true 只把恢复时机推后，不改变「老用户回来仍自动恢复」的产品行为。
      expect(wagmiConfig._internal.ssr).toBe(true);
    },
    IMPORT_TIMEOUT,
  );
});
