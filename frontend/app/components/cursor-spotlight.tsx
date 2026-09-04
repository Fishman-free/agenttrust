"use client";
// 鼠标跟随聚光灯：单一 fixed div，用 transform: translate3d 推位置（GPU 合成）。
// 性能策略：rAF 节流 + lerp 平滑（系数 0.18 给出"跟手但不胶水"的曲线），
// 不读 layout 属性，不触发 reflow。pointer-events:none 不挡任何交互。
// 退化：prefers-reduced-motion 或 pointer:coarse（触屏）整段跳过 ——
// 触屏没鼠标，reduced-motion 用户本就拒绝运动。
import { useEffect, useRef } from "react";

export function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    if (reduced || coarse) {
      // CSS 里也有兜底 display:none，这里再保险一次：
      // 触屏 + reduced-motion 直接不挂事件、不跑 rAF。
      el.style.display = "none";
      return;
    }

    // 初始位置放屏幕中心 —— 页面刚加载时不会出现一个从 0,0 飞过来的硬边
    let x = window.innerWidth * 0.5;
    let y = window.innerHeight * 0.32;
    let tx = x;
    let ty = y;
    let raf = 0;

    const tick = () => {
      // lerp：每帧朝目标移 18%。再大就跟鼠标很硬、再小就有"水银"拖尾感。
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="cursor-spotlight" aria-hidden="true" />;
}