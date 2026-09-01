-- ============================================================
-- 允许 OAuth provider 'github'。
--
-- GitHub 是纯 OAuth 2.0 提供方（授权码 + PKCE），没有 OIDC discovery 端点，
-- 也不签发 id_token；身份取自 https://api.github.com/user 的数字 ID，
-- issuer 记为人造的稳定值 'https://github.com'。见 src/oidc.ts。
-- ============================================================

ALTER TABLE oidc_identities DROP CONSTRAINT IF EXISTS oidc_identities_provider_check;
ALTER TABLE oidc_identities
  ADD CONSTRAINT oidc_identities_provider_check
  CHECK (provider IN ('google', 'github', 'apple', 'casdoor'));

ALTER TABLE oidc_flows DROP CONSTRAINT IF EXISTS oidc_flows_provider_check;
ALTER TABLE oidc_flows
  ADD CONSTRAINT oidc_flows_provider_check
  CHECK (provider IN ('google', 'github', 'apple', 'casdoor'));
