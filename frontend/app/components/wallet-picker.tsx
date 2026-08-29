"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { matchesDefinition, useWalletOptions, type WalletDefinition } from "@/lib/wallets";
import { formatMessage, useLocale } from "@/lib/locale";

type WalletPickerMode = "connect" | "switch";

type WalletPickerApi = {
  /** 总是打开选择面板：无论当前是否已连接，都让用户重新挑一次钱包。 */
  open: (mode?: WalletPickerMode) => void;
  close: () => void;
  isOpen: boolean;
};

const noopApi: WalletPickerApi = { open: () => { }, close: () => { }, isOpen: false };
const WalletPickerContext = createContext<WalletPickerApi>(noopApi);

export function useWalletPicker(): WalletPickerApi {
  return useContext(WalletPickerContext);
}

/** iOS 观感的弹簧：临界阻尼、无过冲；面板出现时同步「材质化」模糊。 */
const panelSpring = { type: "spring" as const, bounce: 0, duration: 0.42 };

export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<WalletPickerMode>("connect");
  // 每次打开都带上新的序号：面板随之重挂载，上一次的错误与 pending 状态不会残留。
  const [openSeq, setOpenSeq] = useState(0);

  const open = useCallback((nextMode: WalletPickerMode = "connect") => {
    setMode(nextMode);
    setOpenSeq((seq) => seq + 1);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const api = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <WalletPickerContext.Provider value={api}>
      {children}
      <WalletPicker key={openSeq} isOpen={isOpen} mode={mode} onClose={close} />
    </WalletPickerContext.Provider>
  );
}

function friendlyReason(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  const lowered = message.toLowerCase();
  if (lowered.includes("user rejected") || lowered.includes("user denied")) return fallback;
  return message.split("\n")[0].slice(0, 160);
}

export function WalletPicker({
  isOpen,
  mode,
  onClose,
}: {
  isOpen: boolean;
  mode: WalletPickerMode;
  onClose: () => void;
}) {
  const { dictionary: t } = useLocale();
  const w = t.walletPicker;
  const { address, connector: activeConnector, isConnected } = useAccount();
  const { connectAsync, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const options = useWalletOptions();
  const [pendingId, setPendingId] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const activeConnectorName = activeConnector?.name;

  // 打开时记住来源焦点，关闭后归还；同时锁定滚动。
  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const { style } = document.body;
    const previous = style.overflow;
    style.overflow = "hidden";
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    first?.focus();
    return () => {
      style.overflow = previous;
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  // 连接成功后自动收起面板。
  useEffect(() => {
    if (isOpen && isConnected && !isPending && !error && pendingId) onClose();
  }, [isOpen, isConnected, isPending, error, pendingId, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const errorMessage = localError
    ?? (error
      ? formatMessage(w.failure, {
        name: pendingId ? (options.find((option) => option.definition.id === pendingId)?.definition.name ?? "") : "",
        reason: friendlyReason(error.message, activeConnectorName ? formatMessage(w.rejected, { name: activeConnectorName }) : error.message),
      })
      : undefined);

  async function selectWallet(definition: WalletDefinition, connector: WalletOptionConnector) {
    if (!connector) return;
    setLocalError(undefined);
    setPendingId(definition.id);
    reset();
    try {
      await connectAsync({ connector });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLocalError(
        formatMessage(w.failure, { name: definition.name, reason: friendlyReason(message, formatMessage(w.rejected, { name: definition.name })) }),
      );
      setPendingId(undefined);
    }
  }

  const heading = mode === "switch" && activeConnectorName ? formatMessage(w.switchSubtitle, { name: activeConnectorName }) : w.subtitle;
  const title = mode === "switch" ? w.switchTitle : w.title;
  const hasAnyWallet = options.some((option) => option.detected);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="picker-root">
          <motion.div
            className="picker-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            onClick={onClose}
          />
          <motion.div
            className="picker-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.94, y: 12, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.96, y: 6, filter: "blur(6px)" }}
            transition={panelSpring}
            style={{ transformOrigin: "top center" }}
          >
            <header className="picker-head">
              <div>
                <h2 className="picker-title" id={titleId}>{title}</h2>
                <p className="picker-sub">{heading}</p>
              </div>
              <button type="button" className="picker-close" onClick={onClose} aria-label={t.common.close}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <ul className="picker-list" role="list">
              {options.map(({ definition, connector, detected }) => {
                const isCurrent = matchesDefinition(activeConnector, definition);
                const isPendingRow = pendingId === definition.id;
                const { Icon } = definition;
                return (
                  <li key={definition.id}>
                    {detected ? (
                      <button
                        type="button"
                        className="picker-row"
                        data-autofocus={detected && !isCurrent ? true : undefined}
                        onClick={() => void selectWallet(definition, connector)}
                        disabled={isPending || isCurrent}
                        aria-current={isCurrent ? "true" : undefined}
                      >
                        <span className="picker-icon" aria-hidden="true"><Icon size={30} /></span>
                        <span className="picker-row-text">
                          <span className="picker-row-name">{definition.name}</span>
                          <span className="picker-row-meta">
                            {isCurrent ? w.current : isPendingRow ? w.connecting : w.detected}
                          </span>
                        </span>
                        <span className="picker-row-tail">
                          {isPendingRow
                            ? <LoaderCircle size={16} className="spin" aria-hidden="true" />
                            : isCurrent
                              ? <span className="picker-dot" aria-hidden="true" />
                              : <ArrowUpRight size={15} aria-hidden="true" />}
                        </span>
                      </button>
                    ) : (
                      <a
                        className="picker-row picker-row-install"
                        href={definition.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="picker-icon picker-icon-dim" aria-hidden="true"><Icon size={30} /></span>
                        <span className="picker-row-text">
                          <span className="picker-row-name">{definition.name}</span>
                          <span className="picker-row-meta">{w.notDetected}</span>
                        </span>
                        <span className="picker-row-tail">
                          <span className="picker-install">{w.install}</span>
                        </span>
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>

            {!hasAnyWallet && <p className="picker-note" role="status">{w.noWallets}</p>}
            {errorMessage && <p className="picker-error" role="alert">{errorMessage}</p>}

            <footer className="picker-foot">
              <p className="picker-privacy">{w.privacy}</p>
              {isConnected ? (
                <div className="picker-foot-actions">
                  <button type="button" className="picker-link" onClick={onClose}>{w.keepConnected}</button>
                  <button
                    type="button"
                    className="picker-link picker-link-danger"
                    onClick={() => { disconnect(); onClose(); }}
                  >
                    {w.disconnect}
                  </button>
                </div>
              ) : (
                <p className="picker-hint">{w.discoverHint}</p>
              )}
              {address && <p className="picker-hint picker-hint-mono">{address}</p>}
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

type WalletOptionConnector = ReturnType<typeof useWalletOptions>[number]["connector"];
