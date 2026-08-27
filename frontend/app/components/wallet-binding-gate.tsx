"use client";

import { Link2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { useAuth } from "@/lib/auth";
import { useLocale } from "@/lib/locale";

function sameWallet(left?: string | null, right?: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function WalletBindingGate({ children }: { children: React.ReactNode }) {
  const { account, linkWallet } = useAuth();
  const { address, isConnected } = useAccount();
  const { connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { dictionary: t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mismatch = isConnected && !sameWallet(account?.wallet, address);
  const blocked = !account?.wallet || mismatch;

  async function connect() {
    setError(undefined);
    try { await connectAsync({ connector: injected() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.walletMissing); }
  }
  async function bind() {
    if (!address) return;
    setBusy(true); setError(undefined);
    try { await linkWallet(address, (message) => signMessageAsync({ message, account: address })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.walletLinkFailed); }
    finally { setBusy(false); }
  }

  return <>
    <div className={blocked ? "wallet-content wallet-gated-content" : "wallet-content"} aria-hidden={blocked || undefined} inert={blocked}>{children}</div>
    {blocked && <main className="binding-gate"><section className="binding-card" aria-label={t.auth.walletGate}>
      <span className="binding-icon">{mismatch ? <ShieldAlert size={22} /> : <Link2 size={22} />}</span>
      <div><span className="home-eyebrow">{t.auth.walletGate}</span><h1>{mismatch ? t.auth.walletMismatchTitle : t.auth.walletLinkTitle}</h1>
        <p>{mismatch ? t.auth.walletMismatchBody : t.auth.walletLinkBody}</p>
        {account?.wallet && <p className="binding-address">{t.auth.boundWallet}: <code>{account.wallet}</code></p>}
        {address && <p className="binding-address">{t.auth.connectedWallet}: <code>{address}</code></p>}
      </div>
      {!isConnected ? <button className="button button-primary" type="button" disabled={connecting} onClick={() => void connect()}>{connecting ? t.common.connecting : t.common.connectWallet}</button>
        : mismatch ? <button className="button button-secondary" type="button" onClick={() => disconnect()}>{t.wallet.disconnect}</button>
          : <button className="button button-primary" type="button" disabled={busy} onClick={() => void bind()}>{busy ? t.auth.signing : t.auth.linkWallet}</button>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section></main>}
  </>;
}
