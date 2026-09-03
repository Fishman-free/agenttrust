"use client";

import { Link2, Plus } from "lucide-react";
import { useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useAuth } from "@/lib/auth";
import { useLocale } from "@/lib/locale";
import { ConnectWalletButton } from "./wallet-status";

function sameWallet(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function WalletBindingGate({ children }: { children: React.ReactNode }) {
  const { account, linkWallet } = useAuth();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { dictionary: t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // 一个账户可有多个钱包：只要当前连接地址在账户钱包清单内即放行。
  const linkedWallets = account?.wallets ?? [];
  const isLinked = Boolean(address && linkedWallets.some((wallet) => sameWallet(wallet, address)));
  // 未连接，或连了一个尚未加入本账户的钱包时，挡住写操作内容。
  const blocked = !isConnected || !isLinked;
  // 账户已经有钱包、当前连接的是清单外的新钱包——这正是旧版误报
  // 「Connected wallet does not match」并把人彻底锁死的场景。
  const unlinkedConnected = isConnected && !isLinked;
  const firstWallet = linkedWallets.length === 0;

  async function bind() {
    if (!address) return;
    setBusy(true); setError(undefined);
    try { await linkWallet(address, (message) => signMessageAsync({ message, account: address })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.walletLinkFailed); }
    finally { setBusy(false); }
  }

  const title = unlinkedConnected && !firstWallet
    ? t.auth.walletAddTitle
    : t.auth.walletLinkTitle;
  const body = unlinkedConnected && !firstWallet
    ? t.auth.walletAddBody
    : t.auth.walletLinkBody;
  const actionLabel = busy
    ? t.auth.signing
    : firstWallet ? t.auth.linkWallet : t.auth.addWallet;

  return <>
    <div className={blocked ? "wallet-content wallet-gated-content" : "wallet-content"} aria-hidden={blocked || undefined} inert={blocked}>{children}</div>
    {blocked && <main className="binding-gate"><section className="binding-card" aria-label={t.auth.walletGate}>
      <span className="binding-icon">{unlinkedConnected && !firstWallet ? <Plus size={22} /> : <Link2 size={22} />}</span>
      <div><span className="home-eyebrow">{t.auth.walletGate}</span><h1>{title}</h1>
        <p>{body}</p>
        {linkedWallets.length > 0 && (
          <div className="binding-address">
            <span>{t.auth.linkedWallets}:</span>
            <ul>
              {linkedWallets.map((wallet) => <li key={wallet.toLowerCase()}><code>{wallet}</code></li>)}
            </ul>
          </div>
        )}
        {address && <p className="binding-address">{t.auth.connectedWallet}: <code>{address}</code></p>}
      </div>
      {!isConnected ? <ConnectWalletButton />
        : <div className="binding-actions">
          <button className="button button-primary" type="button" disabled={busy} onClick={() => void bind()}>{actionLabel}</button>
          <button className="button button-secondary" type="button" onClick={() => disconnect()}>{t.wallet.disconnect}</button>
        </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section></main>}
  </>;
}
