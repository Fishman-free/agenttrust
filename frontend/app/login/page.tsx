"use client";

import { ArrowLeft, FlaskConical, ShieldCheck, Wallet, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { injected } from "wagmi/connectors";
import { CANONICAL_SITE, OIDC_PROVIDER_ORDER, canonicalLoginUrl, sanitizeReturnTo, useAuth, type OidcProvider } from "@/lib/auth";
import { LanguageSwitch } from "@/app/components/language-switch";
import { useLocale } from "@/lib/locale";

/** Tiny inline marks for each provider; sized to 22px so the button row stays optically aligned. */
const providerMarks: Record<OidcProvider, (props: { size?: number }) => React.ReactElement> = {
  google: ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <path d="M21.5 11.2c0-.7-.06-1.4-.18-2.06H11v3.9h5.86a5.02 5.02 0 0 1-2.17 3.3v2.74h3.5c2.05-1.9 3.3-4.7 3.3-7.88z" fill="#4285F4" />
      <path d="M11 22c2.93 0 5.39-.97 7.18-2.62l-3.5-2.72c-.97.66-2.22 1.05-3.68 1.05-2.83 0-5.23-1.91-6.08-4.48H1.32v2.78A11 11 0 0 0 11 22z" fill="#34A853" />
      <path d="M4.92 13.23a6.62 6.62 0 0 1 0-4.22V6.23H1.32a11 11 0 0 0 0 9.78l3.6-2.78z" fill="#FBBC05" />
      <path d="M11 4.6c1.6 0 3.03.55 4.16 1.62l3.1-3.1A11 11 0 0 0 11 0 11 11 0 0 0 1.32 6.23l3.6 2.78C5.77 6.54 8.17 4.6 11 4.6z" fill="#EA4335" />
    </svg>
  ),
  github: ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.92.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.16 1.18a10.93 10.93 0 0 1 5.74 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.44-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.79.55C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z"
      />
    </svg>
  ),
  apple: ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.36 12.65c-.02-2.46 2.02-3.65 2.11-3.7-1.15-1.69-2.94-1.92-3.58-1.94-1.52-.16-2.97.9-3.74.9-.78 0-1.96-.88-3.22-.86-1.65.02-3.18.96-4.03 2.45-1.72 2.99-.44 7.41 1.24 9.83.82 1.19 1.79 2.52 3.06 2.47 1.23-.05 1.7-.79 3.19-.79s1.91.79 3.21.76c1.32-.02 2.16-1.2 2.97-2.4.94-1.38 1.32-2.72 1.34-2.79-.03-.01-2.58-.99-2.6-3.93zM13.93 5.16c.69-.83 1.15-2 1.02-3.15-.99.04-2.19.66-2.9 1.48-.63.73-1.19 1.91-1.04 3.04 1.11.08 2.23-.56 2.92-1.37z"
      />
    </svg>
  ),
  casdoor: ({ size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#3E55A0" d="M3 3h18v18H3V3zm2 2v14h14V5H5z" />
      <path fill="#3E55A0" d="M9 11.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0z" />
    </svg>
  ),
};

const socialLabels: Record<OidcProvider, string> = {
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

  // Show every OIDC provider the backend declares (in its fixed canonical order). A button
  // that is not configured renders as disabled with a clear "Setup required" hint instead of
  // a misleading "Configuring…" label; configured buttons land first so the eye lands on
  // something actionable.
  const providerRows = useMemo(() => OIDC_PROVIDER_ORDER.map((provider) => {
    const capability = capabilities?.oidc[provider];
    return { provider, configured: Boolean(capability?.configured) };
  }), [capabilities]);
  const configuredRow = providerRows.find((row) => row.configured);
  const setupHint = unavailable ? `${CANONICAL_SITE}/login` : t.auth.setupHint;

  return <main className="login-page" data-hero="primary">
    <header className="login-header">
      <Link href="/" className="brand"><ArrowLeft size={16} />AgentTrust</Link>
      <LanguageSwitch />
    </header>

    <section className="login-hero">
      <span className="login-hero-eyebrow">
        <ShieldCheck size={14} aria-hidden="true" />
        {t.auth.accessEyebrowTag}
      </span>
      <h1 className="login-hero-title">
        {t.auth.heroTitle}
      </h1>
      <p className="login-hero-lead">{t.auth.heroLead}</p>
      <ul className="login-hero-benefits" aria-label={t.auth.benefitSession}>
        <li><span className="login-hero-benefits-marker" aria-hidden="true" />{t.auth.benefitSession}</li>
        <li><span className="login-hero-benefits-marker" aria-hidden="true" />{t.auth.benefitWallet}</li>
        <li><span className="login-hero-benefits-marker" aria-hidden="true" />{t.auth.benefitSeparate}</li>
      </ul>
    </section>

    <div className="login-grid">
      <section className="login-stack" aria-label={t.auth.loginOptions}>
        <article className="login-card login-card-primary" aria-labelledby="login-wallet-title">
          <span className="login-card-tag">{t.auth.recommended}</span>
          <header className="login-card-head">
            <span className="login-card-icon" aria-hidden="true"><Wallet size={26} /></span>
            <div>
              <h2 id="login-wallet-title">{t.auth.walletTitle}</h2>
              <span className="login-card-meta">{t.auth.walletBadge}</span>
            </div>
          </header>
          <p className="login-card-body">{t.auth.walletDescription}</p>
          <button
            className="button button-primary login-action"
            type="button"
            onClick={() => void walletLogin()}
            disabled={busy || connecting || !walletEnabled || unavailable}
          >
            {busy || connecting ? t.auth.signing : (isConnected ? t.auth.signWallet : t.auth.connectAndSign)}
          </button>
          {!unavailable && capabilities && !walletEnabled && <p className="form-warning">{t.auth.walletUnavailable}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {unavailable && <a className="button button-secondary login-action" href={canonicalLoginUrl(returnTo ?? "/agents/")}>{t.auth.continueCanonical}</a>}
        </article>

        <article className="login-card" aria-labelledby="login-social-title">
          <header className="login-card-head">
            <span className="login-card-icon login-card-icon-muted" aria-hidden="true"><Sparkles size={22} /></span>
            <div>
              <h2 id="login-social-title">{t.auth.providersHeading}</h2>
              <span className="login-card-meta">{t.auth.socialBadge}</span>
            </div>
          </header>
          <p className="login-card-body login-card-body-tight">{t.auth.providersHint}</p>
          <ul className="login-social-list" role="list">
            {providerRows.map(({ provider, configured }) => {
              const Mark = providerMarks[provider];
              const status = configured
                ? (oidcBusy === provider ? t.auth.redirecting : t.auth.continueWith)
                : t.auth.setupRequired;
              const ariaLabel = configured
                ? `${t.auth.continueWith} ${socialLabels[provider]}`
                : `${socialLabels[provider]} · ${t.auth.setupRequired}`;
              return (
                <li key={provider}>
                  <button
                    type="button"
                    className={`login-social${configured ? "" : " is-disabled"}`}
                    data-provider={provider}
                    disabled={!configured || Boolean(oidcBusy)}
                    aria-disabled={!configured}
                    aria-label={ariaLabel}
                    title={configured ? status : setupHint}
                    onClick={() => void oidcLogin(provider)}
                  >
                    <span className={`login-social-mark login-social-mark-${provider}${configured ? "" : " is-dim"}`} aria-hidden="true">
                      <Mark size={22} />
                    </span>
                    <span className="login-social-text">
                      <span className="login-social-name">{socialLabels[provider]}</span>
                      <small>{status}</small>
                    </span>
                    {!configured && <span className="login-social-warn" aria-hidden="true">!</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {!configuredRow && (
            <p className="login-social-empty" role="status">{setupHint}</p>
          )}
        </article>

        <article className="identity-placeholder login-card">
          <span className="login-card-icon login-card-icon-muted" aria-hidden="true"><ShieldCheck size={22} /></span>
          <div>
            <h2>{t.auth.strongIdentityTitle}</h2>
            <p>{t.auth.strongIdentityPlaceholder}</p>
          </div>
          <span className="login-card-meta">{t.auth.planned}</span>
        </article>

        <details className="labs-card">
          <summary><FlaskConical size={18} />{t.auth.labs}</summary>
          <p>{t.auth.worldIdLabs}</p>
        </details>
      </section>
    </div>
  </main>;
}
