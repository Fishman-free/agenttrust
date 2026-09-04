"use client";

import { useEffect } from "react";

const REVEALED_CLASS = "is-revealed";
const STAGGER_STEP_MS = 90;
const MAX_STAGGER_INDEX = 5;

/**
 * 滚动渐显：带 data-reveal 的元素进入视口后淡入（opacity + 上移 + 轻微去模糊），
 * 同一父节点下的元素按 DOM 顺序错峰，形成 Apple 官网那种编排感而不是散落微交互。
 *
 * 两条兜底保证内容不会"消失"：
 * 1. 隐藏样式只在 <html data-reveal-armed> 下生效（layout.tsx 内联脚本同步打标），
 *    所以 JS 不可用或脚本没跑到时，内容保持可见；
 * 2. 没有 IntersectionObserver 或用户开了 reduced-motion，直接全部标记为已显现。
 */
export function useScrollReveal(): void {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (nodes.length === 0) return;

    const revealAll = () => {
      for (const node of nodes) node.classList.add(REVEALED_CLASS);
    };

    // 错峰延迟：同一父节点内的第几个决定 delay，超出 5 个后统一用最大值，避免尾部等太久
    const groups = new Map<Element, HTMLElement[]>();
    for (const node of nodes) {
      const parent = node.parentElement ?? document.body;
      const siblings = groups.get(parent);
      if (siblings) siblings.push(node);
      else groups.set(parent, [node]);
    }
    for (const siblings of groups.values()) {
      siblings.forEach((node, index) => {
        const step = Math.min(index, MAX_STAGGER_INDEX);
        node.style.setProperty("--reveal-delay", `${step * STAGGER_STEP_MS}ms`);
      });
    }

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
      revealAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(REVEALED_CLASS);
          observer.unobserve(entry.target); // 一次性，显现后不再观察
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);
}
