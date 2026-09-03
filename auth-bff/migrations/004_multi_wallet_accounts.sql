-- ============================================================
-- 一个账户支持关联多个钱包。
--
-- 钱包只是支付/签名工具，不再与账户一一绑定：同一账户可陆续追加多个
-- 钱包地址，切换 MetaMask 账户时可直接把新钱包加入本账户，而不是被
-- 「Connected wallet does not match」永久挡住。
--
-- 保留 wallets.address 的全局唯一：一个地址同一时间只能归属于一个账户，
-- 钱包 SIWE 登录（accountForWallet）仍需要地址 -> 账户的唯一归属。
-- ============================================================

-- 列级 UNIQUE 自动生成的约束名为 wallets_account_id_key。
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_account_id_key;

-- 多钱包后按账户列钱包是常规查询，补一个索引（address 仍由原 UNIQUE 约束索引）。
CREATE INDEX IF NOT EXISTS wallets_account_id_idx ON wallets (account_id);
