-- ============================================================
-- Allow OIDC provider 'github' (GitHub Apps with OIDC enabled).
-- GitHub's OIDC discovery URL is `https://api.github.com/applications/{client_id}`
-- only for GitHub Apps that opt into OIDC; document this in README.
-- ============================================================

ALTER TABLE oidc_identities DROP CONSTRAINT IF EXISTS oidc_identities_provider_check;
ALTER TABLE oidc_identities
  ADD CONSTRAINT oidc_identities_provider_check
  CHECK (provider IN ('google', 'apple', 'github', 'casdoor'));

ALTER TABLE oidc_flows DROP CONSTRAINT IF EXISTS oidc_flows_provider_check;
ALTER TABLE oidc_flows
  ADD CONSTRAINT oidc_flows_provider_check
  CHECK (provider IN ('google', 'apple', 'github', 'casdoor'));
