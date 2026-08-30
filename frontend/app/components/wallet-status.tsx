"use client";

import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { getWriteBlockReason } from "@/lib/config";
import { formatMessage, useLocale } from "@/lib/locale";
import { AccountMenu } from "./account-menu";
import { WalletPicker } from "./wallet-picker";

export type WalletStateProps = { address?: `0x${string}`; chainId?: number; chainName?: string; expectedChainId: number; expectedChainName: string; isConnected: boolean; isConnecting?: boolean; isSwitching?: boolean; error?: string; onConnect: () => void; onDisconnect: () => void; onSwitchChain: () => void };
function shortAddress(address: `0x${string}`) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function WalletState({ address, chainId, chainName, expectedChainId, expectedChainName, isConnected, isConnecting, isSwitching, error, onConnect, onDisconnect, onSwitchChain }: WalletStateProps) {
  const { locale, dictionary: t } = useLocale();
  const wrongNetwork = isConnected && chainId !== expectedChainId;
  return <section className="wallet-panel" aria-label={t.wallet.status}>
    {!isConnected ? <button className="button button-primary" onClick={onConnect} disabled={isConnecting}>{isConnecting ? t.common.connecting : t.common.connectWallet}</button> : <>
      <div className="wallet-details"><span className="wallet-label">{t.wallet.currentAccount}</span><span className="wallet-value" title={address} aria-label={address ? formatMessage(t.wallet.accountValue, { address }) : t.wallet.accountUnknown}>{address ? shortAddress(address) : t.common.unknown}</span><span className="wallet-label">{t.wallet.currentNetwork}</span><span className={wrongNetwork ? "wallet-value network-error" : "wallet-value"}>{chainName ?? `Chain ${chainId ?? t.common.unknown}`}</span></div>
      {wrongNetwork && <button className="button button-warning" onClick={onSwitchChain} disabled={isSwitching}>{isSwitching ? t.wallet.switching : formatMessage(t.wallet.switchTo, { chain: expectedChainName })}</button>}
      <button className="button button-secondary" onClick={onDisconnect}>{t.wallet.disconnect}</button>
    </>}
    {wrongNetwork && <p className="wallet-message" role="alert">{formatMessage(t.wallet.networkError, { chain: expectedChainName, chainId: expectedChainId })}</p>}
    {error && <p className="wallet-message" role="alert">{error}</p>}
    {getWriteBlockReason(locale) && <p className="wallet-message" role="status">{getWriteBlockReason(locale)}</p>}
  </section>;
}

/**
 * 页首钱包控件。
 *
 * 未连接：点击一律先打开钱包选择页（Rabby / MetaMask / 其它已检测钱包），
 * 不再默认复用某一个钱包。连接成功后 wagmi 会把连接写入本地存储，
 * 下次进入页面由 WagmiProvider 的 reconnectOnMount 静默恢复，无需再点一次。
 *
 * 已连接：交给 AccountMenu 提供账户设置（昵称、押金赎回、交易记录、断开）。
 */
export function WalletStatus() {
  const { isConnected } = useAccount();
  const { isPending } = useConnect();
  const { dictionary: t } = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isConnected) return <AccountMenu />;

  return <>
    <button type="button" className="button button-primary" onClick={() => setPickerOpen(true)} disabled={isPending}>
      {isPending ? t.common.connecting : t.common.connectWallet}
    </button>
    <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
  </>;
}

/** 供钱包绑定门禁等场景复用：只负责「先选钱包，再连接」。 */
export function ConnectWalletButton({ label, className }: { label?: string; className?: string }) {
  const { isPending } = useConnect();
  const { dictionary: t } = useLocale();
  const [open, setOpen] = useState(false);
  return <>
    <button
      type="button"
      className={className ?? "button button-primary"}
      onClick={() => setOpen(true)}
      disabled={isPending}
    >
      {isPending ? t.common.connecting : label ?? t.common.connectWallet}
    </button>
    <WalletPicker open={open} onClose={() => setOpen(false)} />
  </>;
}
