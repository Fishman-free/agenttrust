import { Pool, type PoolClient } from "pg";
import type { Address } from "viem";
import type { Provider, Purpose } from "./config.js";

export type Queryable = Pick<Pool | PoolClient, "query">;
export type Challenge = {
  id: string; nonce: string; purpose: Purpose; address: Address;
  account_id: string | null; message: string; expires_at: Date; consumed_at: Date | null;
};
export type Session = { id: string; account_id: string; csrf_hash: Buffer; expires_at: Date };
export type OidcFlow = { id: string; provider: Provider; nonce: string; code_verifier: string; return_to: string; expires_at: Date };

export function createPool(connectionString: string) {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, allowExitOnIdle: true });
}

export class AuthRepository {
  constructor(readonly pool: Pool) {}

  async transaction<T>(fn: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() { await this.pool.query("SELECT 1"); }

  async createChallenge(input: { nonce: string; purpose: Purpose; address: Address; accountId: string | null; message: string; expiresAt: Date }) {
    await this.pool.query(
      `INSERT INTO auth_challenges (nonce, purpose, address, account_id, message, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.nonce, input.purpose, input.address.toLowerCase(), input.accountId, input.message, input.expiresAt],
    );
  }

  async findChallenge(nonce: string) {
    const result = await this.pool.query<Challenge>(
      `SELECT id, nonce, purpose, address, account_id, message, expires_at, consumed_at
       FROM auth_challenges WHERE nonce = $1`, [nonce],
    );
    return result.rows[0] ?? null;
  }

  async consumeChallenge(client: Queryable, id: string) {
    const result = await client.query<Challenge>(
      `UPDATE auth_challenges SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, nonce, purpose, address, account_id, message, expires_at, consumed_at`, [id],
    );
    return result.rows[0] ?? null;
  }

  async accountForWallet(client: Queryable, address: Address) {
    const existing = await client.query<{ account_id: string }>("SELECT account_id FROM wallets WHERE address = $1", [address.toLowerCase()]);
    if (existing.rows[0]) return existing.rows[0].account_id;
    const account = await client.query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id");
    const accountId = account.rows[0]!.id;
    await client.query("INSERT INTO wallets (account_id, address) VALUES ($1, $2)", [accountId, address.toLowerCase()]);
    return accountId;
  }

  async linkWallet(client: Queryable, accountId: string, address: Address) {
    await client.query(
      "INSERT INTO wallets (account_id, address) VALUES ($1, $2)",
      [accountId, address.toLowerCase()],
    );
  }

  /** 地址归属的账户；一个地址全局最多归属一个账户（wallets.address UNIQUE）。 */
  async findWalletOwner(address: Address): Promise<string | null> {
    const result = await this.pool.query<{ account_id: string }>(
      "SELECT account_id FROM wallets WHERE address = $1",
      [address.toLowerCase()],
    );
    return result.rows[0]?.account_id ?? null;
  }

  async createSession(client: Queryable, input: { accountId: string; tokenHash: Buffer; csrfHash: Buffer; expiresAt: Date }) {
    await client.query(
      "INSERT INTO sessions (account_id, token_hash, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)",
      [input.accountId, input.tokenHash, input.csrfHash, input.expiresAt],
    );
  }

  async findSession(tokenHash: Buffer) {
    const result = await this.pool.query<Session>(
      `UPDATE sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id, account_id, csrf_hash, expires_at`, [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(tokenHash: Buffer) {
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [tokenHash]);
  }

  async updateSessionCsrf(sessionId: string, csrfHash: Buffer) {
    await this.pool.query(
      "UPDATE sessions SET csrf_hash = $2 WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()",
      [sessionId, csrfHash],
    );
  }

  /**
   * 账户视图：一个账户可关联多个钱包，wallets 按 linked_at 稳定排序返回。
   * jsonb_agg 经 node-postgres 直接反序列化为 JS 数组；FILTER + COALESCE
   * 保证没有钱包时返回空数组而不是 null。
   */
  async accountView(accountId: string) {
    const account = await this.pool.query<{ id: string; created_at: Date; wallets: string[] }>(
      `SELECT a.id, a.created_at,
              COALESCE(jsonb_agg(w.address ORDER BY w.linked_at, w.id)
                         FILTER (WHERE w.address IS NOT NULL), '[]'::jsonb) AS wallets
       FROM accounts a
       LEFT JOIN wallets w ON w.account_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, a.created_at`, [accountId],
    );
    if (!account.rows[0]) return null;
    const identities = await this.pool.query<{ provider: Provider; issuer: string; email: string | null }>(
      "SELECT provider, issuer, email FROM oidc_identities WHERE account_id = $1 ORDER BY provider", [accountId],
    );
    return { ...account.rows[0], identities: identities.rows };
  }

  async createOidcFlow(input: { provider: Provider; stateHash: Buffer; nonce: string; codeVerifier: string; returnTo: string; expiresAt: Date }) {
    await this.pool.query(
      `INSERT INTO oidc_flows (provider, state_hash, nonce, code_verifier, return_to, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.provider, input.stateHash, input.nonce, input.codeVerifier, input.returnTo, input.expiresAt],
    );
  }

  async consumeOidcFlow(client: Queryable, stateHash: Buffer, provider: Provider) {
    const result = await client.query<OidcFlow>(
      `UPDATE oidc_flows SET consumed_at = now()
       WHERE state_hash = $1 AND provider = $2 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, provider, nonce, code_verifier, return_to, expires_at`, [stateHash, provider],
    );
    return result.rows[0] ?? null;
  }

  async accountForOidc(client: Queryable, input: { provider: Provider; issuer: string; subject: string; email: string | null }) {
    const existing = await client.query<{ account_id: string }>(
      "SELECT account_id FROM oidc_identities WHERE issuer = $1 AND subject = $2", [input.issuer, input.subject],
    );
    if (existing.rows[0]) return existing.rows[0].account_id;
    const account = await client.query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id");
    const accountId = account.rows[0]!.id;
    await client.query(
      "INSERT INTO oidc_identities (account_id, provider, issuer, subject, email) VALUES ($1, $2, $3, $4, $5)",
      [accountId, input.provider, input.issuer, input.subject, input.email],
    );
    return accountId;
  }
}
