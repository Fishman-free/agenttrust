"use client";

import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import { useState } from "react";
import { fetchWorldIdContext, verifyWorldId, type RegistryAttestation, type WorldIdContext } from "@/lib/world-id";

type Props = {
  subject: `0x${string}`;
  disabled?: boolean;
  label: string;
  loadingLabel: string;
  errorLabel: string;
  onAttestation: (attestation: RegistryAttestation) => void;
};

export function WorldIdButton({ subject, disabled, label, loadingLabel, errorLabel, onAttestation }: Props) {
  const [context, setContext] = useState<WorldIdContext>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function begin() {
    setLoading(true); setError(undefined);
    try {
      const next = await fetchWorldIdContext();
      setContext(next); setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorLabel);
    } finally { setLoading(false); }
  }

  async function handleVerify(result: IDKitResult) {
    const attestation = await verifyWorldId(subject, result);
    onAttestation(attestation);
  }

  return (
    <>
      <button type="button" className="button button-primary" disabled={disabled || loading} onClick={begin}>
        {loading ? loadingLabel : label}
      </button>
      {error && <p className="form-error" role="alert">{errorLabel}: {error}</p>}
      {context && (
        <IDKitRequestWidget
          open={open} onOpenChange={setOpen}
          app_id={context.app_id} action={context.action} rp_context={context.rp_context}
          environment={context.environment} allow_legacy_proofs={false} require_user_presence
          preset={proofOfHuman({ signal: subject })}
          handleVerify={handleVerify} onSuccess={() => setOpen(false)}
          onError={(code) => setError(String(code))}
        />
      )}
    </>
  );
}
