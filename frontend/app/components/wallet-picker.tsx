"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect, useConnections, useConnectors } from "wagmi";
import {
  buildWalletOptions,
  readPreferredWallet,
  rememberPreferredWallet,
  type DetectedConnector,
  type WalletOption,
} from "@/lib/wallets";
import { formatMessage, useLocale } from "@/lib/locale";

export type WalletPickerResult = { rdns: string; address?: `0x${string}` };

export type WalletPickerProps = {
  open: boolean;
  onClose: () => void;
  /** 连接成功回调；返回 false 可阻止弹层自动关闭。 */
  onConnected?: (result: WalletPickerResult) => void | boolean | Promise<void | boolean>;
  onError?: (error: Error) => void;
};

/** 弹层必须挂到 body：站点头部带 backdrop-filter，会为 fixed 子元素创建包含块。 */
function canPortal() {
  return typeof document !== "undefined";
}

export function WalletPicker({ open, onClose, onConnected, onError }: WalletPickerProps) {
  const { dictionary: t } = useLocale();
  const connectors = useConnectors();
  const { connectAsync, isPending } = useConnect();
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeRdns, setActiveRdns] = useState<string>();
  const [error, setError] = useState<string>();
  const [justConnected, setJustConnected] = useState<string>();

  const options = useMemo(() => buildWalletOptions(connectors), [connectors]);
  type Option = (typeof options)[number];

  // 没有任何 EIP-6963 钱包被发现时（老钱包、部分容器注入只有 window.ethereum），
  // 把配置里声明的无 target injected 兜底连接器呈现为「浏览器钱包」。
  // 该连接器由 wagmi 以实例形式提供，身份稳定，不在此处新建。
  const optionsWithFallback = useMemo<Option[]>(() => {
    if (options.some((option) => option.detected)) return options;
    const injectedConnector = connectors.find((connector) => connector.type === "injected" && connector.id === "injected");
    if (!injectedConnector) return options;
    return [
      ...options,
      {
        key: "detected:window.ethereum",
        name: "Browser wallet",
        rdns: "window.ethereum",
        colors: ["#6e6e73", "#3a3a3c"] as const,
        glyph: "W",
        installUrl: "",
        connector: injectedConnector,
        detected: true,
        generic: true,
      },
    ];
  }, [options, connectors]);

  // 仅在打开时读取本地偏好。SSR 与首屏 open=false 时该分支不会执行，因此不存在水合差异。
  const preferred = open ? justConnected ?? readPreferredWallet() : undefined;

  const close = useCallback(() => {
    setError(undefined);
    onClose();
  }, [onClose]);

  // 打开时把焦点交给第一个可连接项，键盘用户无需先 Tab 过背景内容。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLButtonElement>("[data-wallet-row]:not([disabled])");
      first?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, optionsWithFallback.length]);

  const fail = useCallback(
    (cause: unknown) => {
      const wrapped = cause instanceof Error ? cause : new Error(String(cause));
      setError(wrapped.message || t.auth.loginFailed);
      onError?.(wrapped);
    },
    [onError, t.auth.loginFailed],
  );

  const connections = useConnections();

  const choose = useCallback(
    async (option: Option) => {
      if (!option.connector) {
        if (option.installUrl) window.open(option.installUrl, "_blank", "noopener,noreferrer");
        return;
      }
      setError(undefined);
      setActiveRdns(option.rdns);
      try {
        // 该钱包此前已经连接成功：跳过 connectAsync（它会抛「Connector already connected」），
        // 直接复用现有连接继续后续流程（如登录签名、切钱包提示）。
          const existing = connections.find((connection) => connection.connector.id === option.connector?.id);
        if (existing) {
          rememberPreferredWallet(option.rdns);
          setJustConnected(option.rdns);
          const keepOpen = await onConnected?.({ rdns: option.rdns, address: existing.accounts[0] });
          if (keepOpen !== false) close();
          return;
        }
        const result = await connectAsync({ connector: option.connector });
        rememberPreferredWallet(option.rdns);
        setJustConnected(option.rdns);
        const address = result.accounts[0];
        const keepOpen = await onConnected?.({ rdns: option.rdns, address });
        if (keepOpen !== false) close();
      } catch (cause) {
        fail(cause);
      } finally {
        setActiveRdns(undefined);
      }
    },
    [close, connectAsync, connections, fail, onConnected],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const rows = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-wallet-row]:not([disabled])") ?? [],
      );
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (current + delta + rows.length) % rows.length;
      rows[next]?.focus();
    },
    [close],
  );

  if (!canPortal()) return null;

  const detectedCount = optionsWithFallback.filter((option) => option.detected).length;
  const sheetTransition = reduceMotion
    ? { duration: 0.18 }
    : ({ type: "spring", bounce: 0.08, duration: 0.42 } as const);
  const rowTransition = reduceMotion
    ? { duration: 0.12 }
    : ({ type: "spring", bounce: 0, duration: 0.34 } as const);

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
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.div
            ref={dialogRef}
            className="wallet-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-picker-title"
            aria-describedby="wallet-picker-subtitle"
            onKeyDown={onKeyDown}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.965 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={sheetTransition}
          >
            <header className="wallet-sheet-head">
              <div>
                <p className="wallet-sheet-eyebrow">{t.wallet.status}</p>
                <h2 id="wallet-picker-title">{t.wallet.chooseTitle}</h2>
                <p id="wallet-picker-subtitle" className="wallet-sheet-sub">{t.wallet.chooseSubtitle}</p>
              </div>
              <button type="button" className="sheet-close" onClick={close} aria-label={t.account.close}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path d="M3 3l9 9M12 3l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <ul className="wallet-option-list">
              {optionsWithFallback.map((option, index) => {
                const connecting = activeRdns === option.rdns && isPending;
                const isPreferred = Boolean(preferred) && preferred === option.rdns && option.detected;
                return (
                  <motion.li
                    key={option.key}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    transition={{ ...rowTransition, delay: reduceMotion ? 0 : Math.min(index * 0.028, 0.22) }}
                  >
                    <button
                      type="button"
                      data-wallet-row
                      className="wallet-option"
                      disabled={isPending}
                      aria-busy={connecting || undefined}
                      onClick={() => void choose(option)}
                    >
                      <WalletMark option={option} />
                      <span className="wallet-option-text">
                        <span className="wallet-option-name">
                          {option.name}
                          {isPreferred && <span className="wallet-option-flag">{t.wallet.lastUsed}</span>}
                        </span>
                        <span className="wallet-option-meta">
                          {connecting
                            ? formatMessage(t.wallet.connectingTo, { wallet: option.name })
                            : option.detected
                              ? t.wallet.detected
                              : t.wallet.notDetected}
                        </span>
                      </span>
                      <span className="wallet-option-action" aria-hidden="true">
                        {connecting ? (
                          <span className="wallet-spinner" />
                        ) : option.detected ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <span className="wallet-option-install">
                            {t.wallet.install}
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M4 9L9 4M9 4H5M9 4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </ul>

            {detectedCount === 0 && (
              <div className="wallet-sheet-empty">
                <p>{t.wallet.noWallets}</p>
                <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>
                  {t.wallet.reload}
                </button>
              </div>
            )}

            {error && <p className="form-error wallet-sheet-error" role="alert">{error}</p>}

            <p className="wallet-sheet-foot">{t.wallet.disclaimer}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function WalletMark<T extends DetectedConnector>({ option }: { option: WalletOption<T> }) {
  if (option.icon) {
    // EIP-6963 的图标是 data URI，交给 next/image 优化只会增加无谓开销。
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="wallet-mark"><img src={option.icon} alt="" width={30} height={30} /></span>;
  }
  return (
    <span
      className="wallet-mark wallet-mark-fallback"
      style={{ backgroundImage: `linear-gradient(150deg, ${option.colors[0]}, ${option.colors[1]})` }}
      aria-hidden="true"
    >
      {option.glyph}
    </span>
  );
}
