import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthRepository, createPool } from "../src/db.js";
import { buildSiweMessage } from "../src/siwe.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL integration", () => {
  const pool = createPool(databaseUrl!);
  const repository = new AuthRepository(pool);
  const address = "0x0000000000000000000000000000000000000001" as const;

  beforeAll(async () => {
    await pool.query(await readFile(resolve(process.cwd(), "migrations/001_initial.sql"), "utf8"));
    await pool.query("TRUNCATE oidc_flows, sessions, auth_challenges, oidc_identities, wallets, accounts CASCADE");
  });
  afterAll(async () => pool.end());

  it("atomically consumes a challenge exactly once under concurrency", async () => {
    const nonce = "abcdefghijklmnop";
    const message = buildSiweMessage(
      { SIWE_DOMAIN: "localhost:3000", SIWE_URI: "http://localhost:3000", SIWE_CHAIN_ID: 31337 }, address,
      "wallet_login", nonce, new Date(), new Date(Date.now() + 300_000),
    );
    await repository.createChallenge({ nonce, purpose: "wallet_login", address, accountId: null, message, expiresAt: new Date(Date.now() + 300_000) });
    const challenge = await repository.findChallenge(nonce);
    const consumed = await Promise.all(Array.from({ length: 8 }, () => repository.transaction((db) => repository.consumeChallenge(db, challenge!.id))));
    expect(consumed.filter(Boolean)).toHaveLength(1);
  });

  it("keys OIDC identities by issuer and subject rather than provider label", async () => {
    const first = await repository.transaction((db) => repository.accountForOidc(db, {
      provider: "google", issuer: "https://issuer.example", subject: "shared-subject", email: null,
    }));
    const sameIdentity = await repository.transaction((db) => repository.accountForOidc(db, {
      provider: "casdoor", issuer: "https://issuer.example", subject: "shared-subject", email: null,
    }));
    const differentIssuer = await repository.transaction((db) => repository.accountForOidc(db, {
      provider: "google", issuer: "https://other-issuer.example", subject: "shared-subject", email: null,
    }));
    expect(sameIdentity).toBe(first);
    expect(differentIssuer).not.toBe(first);
  });

  it("enforces one active wallet per account and global address uniqueness", async () => {
    const first = await repository.transaction((db) => repository.accountForWallet(db, address));
    const same = await repository.transaction((db) => repository.accountForWallet(db, address));
    expect(same).toBe(first);
    const second = await repository.transaction(async (db) => {
      const result = await db.query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id");
      return result.rows[0]!.id;
    });
    await expect(repository.transaction((db) => repository.linkWallet(db, second, address))).rejects.toMatchObject({ code: "23505" });
  });
});
