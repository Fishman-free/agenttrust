-- ============================================================
-- 允许 OIDC provider 'github'。
--
-- GitHub 与 Google / Apple 一样是标准 OIDC provider，生产上统一经 Casdoor 中转
-- （issuer 指向 Casdoor 实例），身份键用 Casdoor 返回的 issuer + subject。
-- 见 docs/authentication.md 与 src/oidc.ts。
-- ============================================================

ALTER TABLE oidc_identities DROP CONSTRAINT IF EXISTS oidc_identities_provider_check;
ALTER TABLE oidc_identities
  ADD CONSTRAINT oidc_identities_provider_check
  CHECK (provider IN ('google', 'github', 'apple', 'casdoor'));

ALTER TABLE oidc_flows DROP CONSTRAINT IF EXISTS oidc_flows_provider_check;
ALTER TABLE oidc_flows
  ADD CONSTRAINT oidc_flows_provider_check
  CHECK (provider IN ('google', 'github', 'apple', 'casdoor'));
