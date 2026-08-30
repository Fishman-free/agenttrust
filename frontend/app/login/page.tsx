"use client";

import { ArrowLeft, Apple, FlaskConical, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { OIDC_PROVIDER_ORDER, canonicalLoginUrl, sanitizeReturnTo, useAuth, type OidcProvider } from "@/lib/auth";
import { LanguageSwitch } from "@/app/components/language-switch";
import { useLocale } from "@/lib/locale";

// 上游的 Google mark 用字符 G；GitHub / Apple 用 lucide 图标
function ProviderMark({ provider }: { provider: OidcProvider }) {
  if (provider === "google") return <span className="google-mark">G</span>;
  if (provider === "github") return <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.16 1.18a10.93 10.93 0 0 1 5.74 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.44-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.79.55C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" /></svg>;
  if (provider === "apple") return <Apple size={19} aria-hidden="true" />;
  return null; // casdoor 隐藏
}

const providerLabels: Record<OidcProvider, string> = {
  google: "Google",
  github: "GitHub",
  apple: "Apple",
  casdoor: "Casdoor",
};

export default function LoginPage() {
  const { state, capabilities, completeWalletLogin, startOidc } = useAuth();
  const { address, isConnected } = useAccount();
  const { connectAsync, isPending: connecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { dictionary: t } = useLocale();
  const [returnTo] = useState<string>(() => {
    if (typeof window === "undefined" || !window.location) return "/agents/";
    const search = new URLSearchParams(window.location.search).get("returnTo");
    return sanitizeReturnTo(search);
  });
  const [busy, setBusy] = useState(false);
  const [oidcBusy, setOidcBusy] = useState<OidcProvider>();
  const [error, setError] = useState<string>();

  useEffect(() => { if (state === "authenticated" && returnTo) window.location.replace(returnTo); }, [state, returnTo]);

  async function walletLogin() {
    setBusy(true); setError(undefined);
    try {
      const account = address ?? (await connectAsync({ connector: injected() })).accounts[0];
      if (!account) throw new Error(t.auth.walletMissing);
      await completeWalletLogin(account, (message) => signMessageAsync({ message, account }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.loginFailed); }
    finally { setBusy(false); }
  }

  async function oidcLogin(provider: OidcProvider) {
    setOidcBusy(provider); setError(undefined);
    try { window.location.assign(await startOidc(provider, returnTo ?? "/agents/")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.loginFailed); setOidcBusy(undefined); }
  }

  const unavailable = state === "unavailable";
  const walletEnabled = capabilities?.wallet.enabled === true && capabilities.wallet.siwe;

  // 仅渲染 OIDC_PROVIDER_ORDER 里前 3 个（google + github + apple），casdoor 是企业自建 provider，藏起来
  const providerRows = useMemo(
    () => OIDC_PROVIDER_ORDER
      .filter((p): p is Exclude<OidcProvider, "casdoor"> => p === "google" || p === "github" || p === "apple")
      .map((provider) => {
        const capability = capabilities?.oidc[provider];
        return { provider, configured: Boolean(capability?.configured) };
      }),
    [capabilities],
  );

  return <main className="login-page">
    <header className="login-header"><Link href="/" className="brand"><ArrowLeft size={16} />AgentTrust</Link><LanguageSwitch /></header>
    <div className="login-grid">
      <section className="login-intro">
        <span className="home-eyebrow"><ShieldCheck size={16} />{t.auth.accessEyebrow}</span>
        <h1>{t.auth.title}</h1>
        <p>{t.auth.subtitle}</p>
        <ul>
          <li>{t.auth.benefitSession}</li>
          <li>{t.auth.benefitWallet}</li>
          <li>{t.auth.benefitSeparate}</li>
        </ul>
      </section>
      <section className="login-stack" aria-label={t.auth.loginOptions}>
        <div className="login-card login-card-primary">
          <span className="login-card-tag">{t.auth.recommended}</span>
          <Wallet size={24} aria-hidden="true" />
          <h2>{t.auth.walletTitle}</h2>
          <p>{t.auth.walletDescription}</p>
          <button className="button button-primary login-action" type="button" onClick={() => void walletLogin()} disabled={busy || connecting || !walletEnabled || unavailable}>{busy || connecting ? t.auth.signing : (isConnected ? t.auth.signWallet : t.auth.connectAndSign)}</button>
          {!unavailable && capabilities && !walletEnabled && <p className="form-warning">{t.auth.walletUnavailable}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {unavailable && <a className="button button-secondary login-action" href={canonicalLoginUrl(returnTo ?? "/agents/")}>{t.auth.continueCanonical}</a>}
        </div>
        <div className="login-social-row">
          {providerRows.map(({ provider, configured }) => (
            <button
              key={provider}
              type="button"
              className={`login-social${configured ? "" : " is-disabled"}`}
              disabled={!configured || Boolean(oidcBusy)}
              aria-disabled={!configured}
              aria-label={`${configured ? t.auth.continueWith : t.auth.configuring} ${providerLabels[provider]}`}
              onClick={() => void oidcLogin(provider)}
              title={configured ? undefined : t.auth.configuring}
            >
              <ProviderMark provider={provider} />
              <span>{providerLabels[provider]}</span>
              <small>{configured ? (oidcBusy === provider ? t.auth.redirecting : t.auth.continueWith) : t.auth.configuring}</small>
            </button>
          ))}
        </div>
        <div className="login-card identity-placeholder"><ShieldCheck size={22} /><div><h2>{t.auth.strongIdentityTitle}</h2><p>{t.auth.strongIdentityPlaceholder}</p></div><span>{t.auth.planned}</span></div>
        <details className="labs-card"><summary><FlaskConical size={18} />{t.auth.labs}</summary><p>{t.auth.worldIdLabs}</p></details>
      </section>
    </div>
  </main>;
}
