"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAccount } from "wagmi";
import {
  ChevronRight,
  CircleUser,
  Receipt,
  Repeat,
  Trash2,
} from "lucide-react";
import { CHAIN_ID } from "@/lib/config";
import { useProfile } from "@/lib/profile";
import { useTxHistory } from "@/lib/tx-history";
import { useLocale } from "@/lib/locale";
import { AccountAvatar } from "./account-avatar";
import { ConnectWalletButton, WalletStatus } from "./wallet-status";
import { useWalletPicker } from "./wallet-picker";
import { DeregisterPanel, ProfilePanel, TransactionsPanel, shortAddress } from "./account-panels";

type Route = "main" | "profile" | "transactions" | "deregister";

/** 账户中心入口：未连接时就是那颗「连接钱包」按钮，已连接时是头像菜单。 */
export function AccountMenu() {
  const { address, isConnected } = useAccount();
  if (!isConnected) return <ConnectWalletButton />;
  // key 带上地址：切换账户时整块重挂载，收起面板并回到主菜单，不需要额外的同步 effect。
  return <ConnectedAccountMenu key={address ?? "anonymous"} />;
}

function ConnectedAccountMenu() {
  const { dictionary: t } = useLocale();
  const a = t.account;
  const { address, chainId } = useAccount();
  const profile = useProfile();
  const { entries } = useTxHistory();
  const picker = useWalletPicker();
  const [isOpen, setIsOpen] = useState(false);
  const [route, setRoute] = useState<Route>("main");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const wrongNetwork = chainId !== undefined && chainId !== CHAIN_ID;
  const pendingCount = entries.filter((entry) => entry.status === "pending").length;

  const close = useCallback(() => {
    setIsOpen(false);
    setRoute("main");
  }, []);

  // 点击外部与 Esc 关闭；关闭时把焦点还给触发按钮。
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (route !== "main") {
        setRoute("main");
        return;
      }
      setIsOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, route]);

  useEffect(() => {
    if (!isOpen) return;
    const first = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    first?.focus();
  }, [isOpen, route]);

  const direction = route === "main" ? -1 : 1;
  const title = route === "profile"
    ? a.profile
    : route === "transactions"
      ? a.transactions
      : route === "deregister"
        ? a.deregisterTitle
        : a.title;

  return (
    <div className="account-root" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${a.openMenu} · ${address ? shortAddress(address) : ""}`}
        // title 带完整地址：既是悬停提示，也让 E2E 能稳定读取当前账户。
        title={address}
        onClick={() => setIsOpen((open) => !open)}
      >
        <AccountAvatar address={address} avatar={profile.avatar} nickname={profile.nickname} size={30} />
        {wrongNetwork && <span className="account-dot" aria-hidden="true" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            className="account-panel"
            role="dialog"
            aria-label={a.title}
            initial={{ opacity: 0, scale: 0.94, y: -8, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, y: -6, filter: "blur(4px)" }}
            transition={{ type: "spring", bounce: 0, duration: 0.38 }}
            style={{ transformOrigin: "top right" }}
          >
            <div className="account-nav">
              {route === "main" ? (
                <div className="account-hero">
                  <AccountAvatar address={address} avatar={profile.avatar} nickname={profile.nickname} size={46} />
                  <div className="account-hero-text">
                    <span className="account-hero-name">{profile.nickname || shortAddress(address ?? "")}</span>
                    {profile.nickname && <span className="account-hero-address mono">{shortAddress(address ?? "")}</span>}
                  </div>
                </div>
              ) : (
                <div className="account-nav-bar">
                  <button type="button" className="account-back" onClick={() => setRoute("main")} data-autofocus>
                    <ChevronRight size={16} className="flip" aria-hidden="true" />
                    {t.common.back}
                  </button>
                  <span className="account-nav-title">{title}</span>
                </div>
              )}
            </div>

            <div className="account-body">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={route}
                  initial={{ opacity: 0, x: 18 * direction }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 * direction }}
                  transition={{ type: "spring", bounce: 0, duration: 0.28 }}
                >
                  {route === "main" && (
                    <ul className="account-list" role="list">
                      <MenuRow
                        icon={<CircleUser size={16} aria-hidden="true" />}
                        label={a.profile}
                        desc={a.profileDesc}
                        onSelect={() => setRoute("profile")}
                      />
                      <MenuRow
                        icon={<Receipt size={16} aria-hidden="true" />}
                        label={a.transactions}
                        desc={a.transactionsDesc}
                        detail={pendingCount > 0 ? `${pendingCount} · ${a.txPending}` : undefined}
                        onSelect={() => setRoute("transactions")}
                      />
                      <MenuRow
                        icon={<Repeat size={16} aria-hidden="true" />}
                        label={a.switchAccount}
                        desc={a.switchAccountDesc}
                        onSelect={() => { close(); picker.open("switch"); }}
                      />
                      <MenuRow
                        icon={<Trash2 size={16} aria-hidden="true" />}
                        label={a.deregister}
                        desc={a.deregisterDesc}
                        tone="danger"
                        onSelect={() => setRoute("deregister")}
                      />
                    </ul>
                  )}
                  {route === "profile" && <ProfilePanel key={`${address ?? ""}:${profile.ready}`} />}
                  {route === "transactions" && <TransactionsPanel />}
                  {route === "deregister" && <DeregisterPanel onDone={() => setRoute("main")} />}
                </motion.div>
              </AnimatePresence>

              {route === "main" && (
                <div className="account-wallet">
                  <span className="account-section-label">{a.networkSection}</span>
                  <WalletStatus variant="embedded" onAfterDisconnect={close} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  desc,
  detail,
  tone,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  detail?: string;
  tone?: "danger";
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={tone === "danger" ? "account-row account-row-danger" : "account-row"}
        onClick={onSelect}
      >
        <span className="account-row-icon" aria-hidden="true">{icon}</span>
        <span className="account-row-text">
          <span className="account-row-label">{label}</span>
          {desc && <span className="account-row-desc">{desc}</span>}
        </span>
        {detail && <span className="account-row-detail">{detail}</span>}
        <ChevronRight size={15} className="account-row-chevron" aria-hidden="true" />
      </button>
    </li>
  );
}
