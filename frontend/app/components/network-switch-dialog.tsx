"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN_ID, activeChain } from "@/lib/config";
import { formatMessage, useLocale } from "@/lib/locale";

/**
 * 错链引导弹窗。
 *
 * 根因（本次修复的问题）：钱包连在非目标链上时，站点此前只把状态渲染成一行
 * 被动的内联提示（`Network error: switch to Base Sepolia (Chain ID 84532).`），
 * 而且 AccountMenu 里的那份提示要用户主动点开头像菜单才看得到。
 * 用户看到报错却不知道「去哪里切、怎么切」，于是卡住。
 *
 * 这里的做法：把错链状态升级为一次主动弹窗，直接说出「把 Rabby 切到 Base Sepolia」
 * 并给出可照做的步骤；同时保留一键 wallet_switchEthereumChain /
 * wallet_addEthereumChain 的快捷通道（wagmi 的 switchChain 在链不存在时会自动改调 addChain）。
 */

/** 常见链的显示名：不知道名字时只报 Chain ID，用户依然无从下手。 */
const KNOWN_CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  56: "BNB Smart Chain",
  137: "Polygon",
  8453: "Base",
  84532: "Base Sepolia",
  11155111: "Sepolia",
  31337: "Anvil (local)",
};

export type NetworkSwitchDialogProps = {
  open: boolean;
  /** 钱包当前所在链；未连接或未知时留空。 */
  currentChainId?: number;
  /** 钱包当前链名，缺省时按 Chain ID 推断。 */
  currentChainName?: string;
  expectedChainId: number;
  expectedChainName: string;
  /** 已连接钱包的展示名（EIP-6963 提供，如 Rabby）。 */
  walletName: string;
  isSwitching?: boolean;
  /** 切换失败时的原因文案。 */
  error?: string;
  onSwitch: () => void;
  onDismiss: () => void;
};

/** 纯展示组件：不碰 wagmi，便于单测直接断言文案与交互。 */
export function NetworkSwitchDialog({
  open,
  currentChainId,
  currentChainName,
  expectedChainId,
  expectedChainName,
  walletName,
  isSwitching,
  error,
  onSwitch,
  onDismiss,
}: NetworkSwitchDialogProps) {
  const { dictionary: t } = useLocale();
  const reduceMotion = useReducedMotion();
  const primaryRef = useRef<HTMLButtonElement>(null);

  // 打开后把焦点交给「切换」按钮，键盘用户可以直接回车确认。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  // 弹层挂到 body：站点头部带 backdrop-filter，会为 fixed 子元素创建包含块。
  if (typeof document === "undefined") return null;

  const switchLabel = formatMessage(t.wallet.switchTo, { chain: expectedChainName });
  const currentLabel = currentChainName
    ?? (currentChainId !== undefined && KNOWN_CHAIN_NAMES[currentChainId]
      ? `${KNOWN_CHAIN_NAMES[currentChainId]} · ${currentChainId}`
      : formatMessage(t.wallet.networkGuideUnknownChain, { chainId: currentChainId ?? 0 }));

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.24, ease: [0.4, 0, 0.2, 1] }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onDismiss();
          }}
        >
          <motion.div
            className="wallet-sheet network-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="network-switch-title"
            aria-describedby="network-switch-body"
            onKeyDown={onKeyDown}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.965 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={reduceMotion ? { duration: 0.18 } : ({ type: "spring", bounce: 0.08, duration: 0.42 } as const)}
          >
            <header className="wallet-sheet-head">
              <div>
                <p className="wallet-sheet-eyebrow is-warning">{t.wallet.networkGuideEyebrow}</p>
                <h2 id="network-switch-title">
                  {formatMessage(t.wallet.networkGuideTitle, { wallet: walletName, chain: expectedChainName })}
                </h2>
                <p id="network-switch-body" className="wallet-sheet-sub">
                  {formatMessage(t.wallet.networkGuideBody, { chain: expectedChainName, chainId: expectedChainId })}
                </p>
              </div>
              <button type="button" className="sheet-close" onClick={onDismiss} aria-label={t.account.close}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path d="M3 3l9 9M12 3l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="network-compare">
              <div className="network-compare-cell is-wrong">
                <span>{t.wallet.networkGuideCurrent}</span>
                <strong>{currentLabel}</strong>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 8h11M10 4.5L13.5 8 10 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="network-compare-cell is-right">
                <span>{t.wallet.networkGuideTarget}</span>
                <strong>{expectedChainName} · {expectedChainId}</strong>
              </div>
            </div>

            <p className="network-steps-title">{t.wallet.networkGuideStepsTitle}</p>
            <ol className="network-steps">
              {t.wallet.networkGuideSteps.map((step) => (
                <li key={step}>
                  {formatMessage(step, { wallet: walletName, chain: expectedChainName, chainId: expectedChainId })}
                </li>
              ))}
            </ol>

            <p className="wallet-sheet-foot">
              {formatMessage(t.wallet.networkGuideAuto, { action: switchLabel, wallet: walletName })}
            </p>

            {error && <p className="form-error network-sheet-error" role="alert">{error}</p>}

            <div className="network-sheet-actions">
              <button type="button" className="button button-secondary" onClick={onDismiss}>
                {t.wallet.networkGuideDismiss}
              </button>
              <button
                ref={primaryRef}
                type="button"
                className="button button-primary"
                disabled={isSwitching}
                onClick={onSwitch}
              >
                {isSwitching ? t.wallet.switching : switchLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * 全局错链守卫：挂在应用外壳里，只要「已连接且不在目标链」就弹出引导。
 *
 * 关闭只对「当前账户 + 当前错链」这一组合生效：换到一个新的错误链、
 * 或换一个钱包，都会重新弹出，不会让用户永久失去指引。
 * 关掉之后页首头像仍会显示「网络不符」，账户菜单里也保留切换按钮作为兜底入口。
 */
export function NetworkSwitchGate() {
  const { dictionary: t } = useLocale();
  const { address, chainId, isConnected, connector } = useAccount();
  const { switchChain, isPending, error, reset } = useSwitchChain();
  const [dismissed, setDismissed] = useState<string>();

  const wrongNetwork = isConnected && typeof chainId === "number" && chainId !== CHAIN_ID;
  const signature = `${address ?? ""}:${chainId ?? ""}`;
  const open = Boolean(wrongNetwork) && dismissed !== signature;

  // EIP-6963 发现的钱会带真实名字（Rabby / MetaMask…）；兜底连接器叫 Injected，没有指导意义。
  const walletName = connector?.name && connector.name !== "Injected"
    ? connector.name
    : t.wallet.networkGuideWalletFallback;

  return (
    <NetworkSwitchDialog
      open={open}
      currentChainId={chainId}
      expectedChainId={CHAIN_ID}
      expectedChainName={activeChain.name}
      walletName={walletName}
      isSwitching={isPending}
      error={error
        ? formatMessage(t.wallet.networkGuideError, { wallet: walletName, chain: activeChain.name, chainId: CHAIN_ID })
        : undefined}
      onSwitch={() => switchChain({ chainId: CHAIN_ID })}
      onDismiss={() => {
        reset?.();
        setDismissed(signature);
      }}
    />
  );
}
