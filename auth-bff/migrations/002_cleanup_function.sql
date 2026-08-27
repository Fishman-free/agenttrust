CREATE OR REPLACE FUNCTION auth_bff_delete_expired_data()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day';
  DELETE FROM oidc_flows WHERE expires_at < now() - interval '1 day';
  DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';
$$;
