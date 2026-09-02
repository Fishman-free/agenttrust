# Casdoor 中转登录：管理员上线清单（2026-09-02 修订版）

这份清单给**服务器管理员**执行。开发用的 `agenttrust-dev` SSH 账号是受限的前端发布号
（无 Docker、无 Casdoor 访问权、无 `/etc/agenttrust` 读权限、禁止端口转发），
因此下面这些步骤**必须**由管理员本人完成。

> **2026-09-02 实地核查修订**：生产服务器（东京 `54.238.214.186`）上的实际进度
> 远超初版清单的假设。Casdoor 已部署运行、两个 OAuth provider 已建、原生回调已登记、
> 旧版「单应用 + provider_hint」BFF 已在产线跑通社交登录。
> **当前剩余工作只有一件：把产线升级到 main（PR #39 双应用协议），BFF 与前端必须同批部署。**
> 初版清单的第一至五步已被产线现状覆盖，保留在文末「附录」仅作审计参考。

---

## 现状盘点（2026-09-02 核查结果）

| 项 | 状态 |
|---|---|
| Casdoor 容器（casbin/casdoor v3.161.1 + Postgres 17.6，端口 127.0.0.1:8000） | ✅ 运行中（2026-08-29 起） |
| `login.agenttrust.site` DNS + HTTPS | ✅ 指向东京机，discovery 端点 200 |
| Casdoor 内 `provider_google`（client `1070953498325-…`）与 `provider_github`（client `Ov23li0xX5VSeoIju4Ze`） | ✅ 已创建 |
| Google / GitHub 原生控制台回调登记（`https://login.agenttrust.site/callback/provider_google|provider_github`） | ✅ 已实测放行 |
| Casdoor `agenttrust` 应用（client `63808dbff09be34d759a`） | ✅ 存在，挂载 google + github 两个 provider |
| Web3 / MetaMask provider | ✅ 不存在（仅 OAuth×2、Payment×2、Captcha×1） |
| 产线 Auth BFF（`agenttrust-auth-bff@production.service`，2026-08-28 构建） | ⚠️ **旧协议**：单 Casdoor 应用 + `provider_hint`，env 用 `CASDOOR_OIDC_*` + `CASDOOR_SOCIAL_PROVIDERS` |
| BFF 数据库迁移 | ⚠️ 停在 `003_casdoor_only_oidc.sql`（约束只允许 `casdoor`） |
| 线上前端（/var/www/agenttrust，2026-08-29 构建） | ⚠️ **旧协议**：调 `/oidc/casdoor/start`（body 带 provider），读 `capabilities.social.*` |
| main 分支（PR #39 起） | 新协议：`GOOGLE_OIDC_*` / `GITHUB_OIDC_*` 四项齐全制，前端调 `/oidc/google|github/start`，读 `capabilities.oidc.*.configured` |

**核心结论：旧 BFF 与新前端、新 BFF 与旧前端双向都不兼容，没有灰度空间，必须同批切换。**

---

## 零、Casdoor 侧改动（唯一需要动 Casdoor 的地方）

main 代码把 `google` / `github` 当作两个独立 OIDC provider（各自独立的 issuer/client/secret/redirect），
需要一个 Casdoor 应用只挂 Google、另一个只挂 GitHub：

1. 复制现有 `agenttrust` 应用两次：
   - **`agenttrust-google`**：Providers **只勾** `provider_google`，重定向 URL 填
     `https://agenttrust.site/api/auth/oidc/google/callback`，Authorization Code 勾选，关密码登录。
   - **`agenttrust-github`**：Providers **只勾** `provider_github`，重定向 URL 填
     `https://agenttrust.site/api/auth/oidc/github/callback`，同上。
2. 记下两个应用各自的 Client ID / Client Secret。
3. 原有 `agenttrust` 应用（client `63808dbff09be34d759a`）保留：升级期间它服务旧版 BFF 回滚窗口，
   升级完成并稳定后可禁用（见第五步）。
4. 原生控制台**无需改动**——Casdoor 的 provider 级回调（`/callback/provider_google` 等）已登记，
   Casdoor 应用级 redirect URL 不经过 Google/GitHub 校验。

> 备选方案（单应用 + `provider_hint=google|github`）正是当前产线旧版 BFF 的做法；
> main 已改为双应用方案，不要再按 hint 方案配置。

## 一、更新 BFF 的 env（`/etc/agenttrust/auth-bff-production.env`）

在新协议下每个 provider 四项齐全才算配置完成（fail closed）。新增以下变量
（`CASDOOR_OIDC_*` 保留——`casdoor` provider 本身仍用它们；`CASDOOR_SOCIAL_PROVIDERS` 删除，新代码不读）：

```bash
GOOGLE_OIDC_ISSUER=https://login.agenttrust.site
GOOGLE_OIDC_CLIENT_ID=<agenttrust-google 应用的 Client ID>
GOOGLE_OIDC_CLIENT_SECRET=<agenttrust-google 应用的 Client Secret>
GOOGLE_OIDC_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/google/callback

GITHUB_OIDC_ISSUER=https://login.agenttrust.site
GITHUB_OIDC_CLIENT_ID=<agenttrust-github 应用的 Client ID>
GITHUB_OIDC_CLIENT_SECRET=<agenttrust-github 应用的 Client Secret>
GITHUB_OIDC_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/github/callback
```

要点：

- 这四个值**都是 Casdoor 签发的**，不是 Google/GitHub 控制台的原生凭据；原生凭据只存在于
  Casdoor 后台（现已正确存放在 `/etc/agenttrust/casdoor-bootstrap.env`），不要写进 BFF env 或 git。
- `AUTH_ORIGINS` 保持留空（当前文件里未出现即正确）；`COOKIE_SECURE=true`、
  `COOKIE_NAME=__Host-…`、`NODE_ENV=production` 均已就位，保持不动。
- 编辑后 `chmod 600` 并保持属主不变。

## 二、部署新 BFF（含数据库迁移）

产线布局：代码 `/opt/agenttrust/auth-bff`（systemd 模板 `agenttrust-auth-bff@.service` 跑 `dist/src/server.js`，
Node ≥22），env 在 `/etc/agenttrust/auth-bff-production.env`。历史版本已有 `.previous-*` 目录惯例，照做即可。

1. **备份**：`sudo cp -a /opt/agenttrust/auth-bff /opt/agenttrust/auth-bff.previous-$(date +%Y%m%d-%H%M%S)`。
2. 上传 main 的 `auth-bff/`（或 git clone 后 rsync），保留 `node_modules` 或重新 `npm ci --omit=dev`；
   `npm run build` 生成 `dist/`。
3. **先跑迁移再重启**：`npm run migrate`（读同一 env 的 `DATABASE_URL`）。
   它会把 `003_add_github_provider.sql` 应用到 `auth_bff` 库，把两个表的
   `provider` CHECK 从「仅 casdoor」放宽为 `google/github/apple/casdoor`。
   旧库记录显示已应用的是名字不同的 `003_casdoor_only_oidc.sql`，新文件名不同会被当作
   未执行而正常应用；迁移文件开头对旧约束有 `DROP CONSTRAINT IF EXISTS` 兜底，可安全重放。
4. `sudo systemctl restart agenttrust-auth-bff@production`，随后
   `journalctl -u agenttrust-auth-bff@production -f` 确认启动无报错。

## 三、同批部署新前端

线上前端是 Next 静态导出，部署在 `/var/www/agenttrust`（属主与权限保持现状，先备份成
`.previous-*` 目录）。在 main 上执行：

```bash
cd frontend && npm ci && npm run build   # next build（输出 static export）
```

把导出产物同步到 `/var/www/agenttrust/`（rsync --delete 前先确认无 `.well-known` 等手工文件，
有则保留）。**注意必须与第二步同批完成**：新 BFF 上线而前端未更新时，登录页会因
`capabilities` 结构变化显示不可用；反之亦然。

## 四、验证（按顺序）

1. `curl https://agenttrust.site/api/auth/capabilities`
   —— 新格式应出现 `oidc: { google: {configured:true}, github: {configured:true}, … }`
   （不再有 `social` 字段）。
2. 打开 `https://agenttrust.site/login/`，Google / GitHub 按钮显示「继续」而非「需要配置」。
3. 点 Google → 应直跳 Google 授权页（Casdoor 双应用方案无 provider 选择页）→ 授权后回到
   `https://agenttrust.site/agents/` 且已登录。
4. GitHub 按钮重复上一步。
5. 钱包登录回归测试（SIWE 登录、会话、登出），确认同批切换未破坏钱包路径。
6. BFF 日志确认 migration 记录了 `003_add_github_provider.sql`。

## 五、收尾与回滚

**收尾**（观察 1–2 天稳定后）：

- 在 Casdoor 里禁用旧 `agenttrust` 应用（或改只留作回滚用途，直到确认不再回滚）。
- 删除 BFF env 里的 `CASDOOR_SOCIAL_PROVIDERS`（第二步部署前就应删除）。
- 更新 `docs/authentication.md` 若描述与实际有出入。

**回滚**（若切换后登录不可用）：

1. `sudo systemctl stop agenttrust-auth-bff@production`，把
   `/opt/agenttrust/auth-bff.previous-<时间戳>` 换回 `/opt/agenttrust/auth-bff`，
2. **不需要回滚数据库**——`003` 新约束是旧代码的合法超集（旧代码只写 `casdoor`，
   CHECK 放宽不影响），直接重启旧 BFF 即可恢复旧协议。
3. `/var/www/agenttrust` 换回 `.previous-*` 前端目录。
4. 旧 BFF 起跳走 `agenttrust` 应用 + `provider_hint`，该应用未删即回滚可用——
   所以第五节收尾里的「禁用旧应用」必须放在稳定观察期之后。

---

## 附录：初版清单的已完成步骤（审计留档，勿重复执行）

以下内容在产线上已经完成，列在此处仅用于核对，不要重做：

- **部署 Casdoor**：compose 在 `/opt/agenttrust/casdoor/docker-compose.yml`
  （pin `casbin/casdoor@sha256:f6dfa0…`，Postgres internal 网络，端口仅 127.0.0.1:8000），
  Caddy 反代 `login.agenttrust.site`。
- **安全加固**：默认口令已改（`casdoor-bootstrap.env` 存有 `CASDOOR_ADMIN_PASSWORD` 与
  TOTP secret/recovery code，即 MFA 已配）；Casdoor 内无 MetaMask/Web3 provider；
  数据库不对外。**尚未确认**：管理界面 IP 限制、备份恢复演练——见下方待办。
- **配 provider**：`provider_google` / `provider_github` 已建，原生 client id/secret
  已录入，回调 `https://login.agenttrust.site/callback/provider_google|provider_github`
  已在 Google / GitHub 控制台登记（实测放行）。
- **建应用**：旧方案的单应用 `agenttrust` 已建并在用；新方案的两个应用按第零节创建。

**仍待办（与本次升级无强依赖，尽快排期）**：

- [ ] Casdoor 管理界面加 IP/VPN 限制（现仅靠强口令 + MFA）。
- [ ] Casdoor Postgres 卷备份 + 一次真实恢复演练。
- [ ] 关闭 Casdoor 公开自注册（确认 `built-in` 组织的注册开关）。
- [ ] 定期任务：`SELECT auth_bff_delete_expired_data();`（BFF README 建议）。
