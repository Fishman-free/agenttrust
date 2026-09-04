import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollReveal } from "@/app/components/scroll-reveal";

type Entry = { isIntersecting: boolean; target: Element };

function Probe() {
  useScrollReveal();
  return (
    <div>
      <p data-reveal>one</p>
      <p data-reveal>two</p>
      <p data-reveal>three</p>
    </div>
  );
}

const originalObserver = globalThis.IntersectionObserver;
// jsdom 不一定实现 matchMedia，先存下原值（可能是 undefined）再还原
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.IntersectionObserver = originalObserver;
  window.matchMedia = originalMatchMedia;
});

describe("useScrollReveal", () => {
  it("reveals on viewport entry and staggers siblings in DOM order", () => {
    let emit: (entries: Entry[]) => void = () => {};
    const observed: Element[] = [];
    const unobserve = vi.fn();

    globalThis.IntersectionObserver = class {
      constructor(callback: (entries: Entry[]) => void) {
        emit = callback;
      }
      observe(element: Element) {
        observed.push(element);
      }
      unobserve = unobserve;
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;

    const { container } = render(<Probe />);
    const items = Array.from(container.querySelectorAll("[data-reveal]"));

    expect(observed).toHaveLength(3);
    // 同组错峰：0 / 90 / 180ms
    expect(items.map((item) => (item as HTMLElement).style.getPropertyValue("--reveal-delay"))).toEqual([
      "0ms",
      "90ms",
      "180ms",
    ]);

    // 进入视口前保持未显现（隐藏样式由 CSS 的 data-reveal-armed 控制）
    expect(items[0].classList.contains("is-revealed")).toBe(false);

    emit([{ isIntersecting: false, target: items[0] }]);
    expect(items[0].classList.contains("is-revealed")).toBe(false);

    emit([{ isIntersecting: true, target: items[0] }]);
    expect(items[0].classList.contains("is-revealed")).toBe(true);
    expect(items[1].classList.contains("is-revealed")).toBe(false);
    // 一次性：显现后立刻取消观察
    expect(unobserve).toHaveBeenCalledWith(items[0]);
  });

  it("shows everything when IntersectionObserver is missing", () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;

    const { container } = render(<Probe />);

    for (const item of Array.from(container.querySelectorAll("[data-reveal]"))) {
      expect(item.classList.contains("is-revealed")).toBe(true);
    }
  });

  it("shows everything under prefers-reduced-motion without observing", () => {
    const observe = vi.fn();
    globalThis.IntersectionObserver = class {
      observe = observe;
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
    // jsdom 默认没有 matchMedia，这里直接挂一个"用户要求减少动效"的假实现
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
    })) as unknown as typeof window.matchMedia;

    const { container } = render(<Probe />);

    for (const item of Array.from(container.querySelectorAll("[data-reveal]"))) {
      expect(item.classList.contains("is-revealed")).toBe(true);
    }
    expect(observe).not.toHaveBeenCalled();
  });
});
