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

### 2026-09-04 补充实测（当前线上故障的确定根因）

`agenttrust-google` / `agenttrust-github` 两个应用**已经建好、provider 也已经挂上**，
但 provider 项的三个开关被留在关闭状态。直接查 Casdoor 库得到：

```
agenttrust        | provider_google + provider_github | canSignUp=true  canSignIn=true   canUnlink=true   ← 旧应用，按钮正常
agenttrust-google | provider_google                   | canSignUp=false canSignIn=false  canUnlink=false  ← 线上报错的这个
agenttrust-github | provider_github                   | canSignUp=false canSignIn=false  canUnlink=false
```

`client_id=c9c9f7cf0f7f234b0986`（用户报错 URL 里的那个）确认为 `agenttrust-google`。
Casdoor 登录页只渲染 `canSignIn=true` 的 provider，所以两个新应用**一个按钮都不渲染**，
只剩 "To access agenttrust-google:" 标题 —— 与用户所见完全一致。
上游 `provider_google` / `provider_github` 本身是好的（表里有正确的原生 client id），
问题只出在应用级开关。

**源码佐证（v3.161.1，与线上镜像一致）** —— 登录页渲染 provider 按钮的完整链路：

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 渲染入口 | `web/src/auth/LoginPage.js:988` | `application.providers.filter(item => this.isProviderVisible(item))` |
| 按模式分派 | `web/src/auth/LoginPage.js:623` | 登录态走 `Setting.isProviderVisibleForSignIn` |
| **开关判断** | `web/src/Setting.js:789` | `if (providerItem.canSignIn === false) return false;` |
| 第二道闸 | `web/src/Setting.js:758` | `provider` 未回填、或 category 不在 OAuth/SAML/Web3 → false |

数据库里 `provider: null` 是正常的（写入前 Casdoor 会清空内嵌对象，读取时回填），
旧应用也一样，所以第二道闸不是问题。**唯一的差异就是那三个布尔开关。**

> 顺带排掉一个伪解法：起跳 URL 带 `provider_hint` 可以自动跳转、不用点按钮，
> 但那段逻辑在 `filter` 之后的 `map` 里（`LoginPage.js:990`），
> provider 已经被 `canSignIn=false` 过滤掉了，hint 匹配不到，救不了。

**修复动作：把那三个开关的 SignIn 打开即可，零代码、保存即生效、老用户零影响。**

---

## 零、Casdoor 侧改动（唯一需要动 Casdoor 的地方）

main 代码把 `google` / `github` 当作两个独立 OIDC provider（各自独立的 issuer/client/secret/redirect），
需要一个 Casdoor 应用只挂 Google、另一个只挂 GitHub：

1. 复制现有 `agenttrust` 应用两次：
   - **`agenttrust-google`**：Providers **只勾** `provider_google`，重定向 URL 填
     `https://agenttrust.site/api/auth/oidc/google/callback`，Authorization Code 勾选，关密码登录。
   - **`agenttrust-github`**：Providers **只勾** `provider_github`，重定向 URL 填
     `https://agenttrust.site/api/auth/oidc/github/callback`，同上。
   - ⚠️ **勾上 provider 之后，还要把该 provider 项里的 `SignIn` 开关打开。**
     Casdoor 把每个 provider 项拆成 SignUp / SignIn / Unlink 三个复选框，默认全关；
     只勾 provider 而 SignIn 关着，登录页会一个按钮都不渲染 —— 这正是 2026-09-04
     线上故障的根因（详见「现状盘点」末尾的补充实测）。
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

## 四点五、常见故障速查（按症状直接跳修）

| 症状 | 第一时间验证 | 修复位置 |
| --- | --- | --- |
| **点 Google/GitHub 按钮跳 Casdoor 后只显示 "To access agenttrust-google:" 标题，下方空白（无任何登录方式按钮可点）** | 查库确认：`sudo docker exec casdoor-casdoor-postgres-1 psql -U casdoor -d casdoor -t -A -c "SELECT name, providers FROM application;" \| grep agenttrust`，看 provider 项里的 `canSignIn` 是不是 `false` | **第零节** —— 根因是 provider 项的 **SignIn 开关没开**（provider 本身已挂上，不是没勾）。Casdoor 里编辑 `agenttrust-google` → Providers → 把 `provider_google` 那一行的 **SignIn** 勾上；GitHub 同理勾 `agenttrust-github` 里 `provider_github` 的 SignIn。保存即热加载，不用重启容器 |
| 点 Google 跳 Casdoor 后直接回到登录页（"未授权"） | 同上 + 看 Casdoor 日志 `docker logs casdoor-app 2>&1 \| tail -50` | Casdoor 应用里 Check **Authorized redirect URI** 必须填 `https://agenttrust.site/api/auth/oidc/google/callback`（或 github）——拼写错误、空格、结尾斜杠都会失败 |
| `curl /api/auth/capabilities` 里 `oidc.google.configured=false` | `sudo cat /etc/agenttrust/auth-bff-production.env \| grep GOOGLE_OIDC` | **第一节** —— 四个 `GOOGLE_OIDC_*` 必须齐全（ISSUER、CLIENT_ID、CLIENT_SECRET、REDIRECT_URI），缺一项就 fail closed |
| 登录成功跳回 `https://agenttrust.site/` 而不是 `/agents/` | 看 `?returnTo=` 是否被前端拼上 | **第一节** + `RETURN_TO_ORIGINS` 必须含 `https://agenttrust.site` |
| BFF 日志报 `issuer mismatch` 或 `discovery failed` | `curl https://login.agenttrust.site/.well-known/openid-configuration` | 第零节建应用时默认 issuer 就是 Casdoor 自己；若改了要把新 issuer 写进 BFF env |
| **任意时刻想走"直连绕过 Casdoor"** | 看 **第七节** —— 部署 Google/GitHub 直连 OAuth（牺牲 Casdoor 留的运维便利，换"不再依赖 Casdoor 配置正确"） | 第七节 |

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

## 七、直连绕过 Casdoor（兜底方案，不用改前端）

**什么时候用这一节**：点 Google / GitHub 按钮后跳到 `login.agenttrust.site`，页面只有
"To access agenttrust-google:" 一行标题、下面没有任何可点的登录方式，而管理员暂时动不了 Casdoor。
已知根因是 Casdoor 应用里 provider 项的 **SignIn 开关没开**（见「现状盘点」末尾的 2026-09-04 补充实测），
管理员只要勾一下就能好；本节的直连路径是管理员不可达时的自救手段。

代价：丢掉 Casdoor 提供的统一审计和多 provider 编排便利。换回中转随时可以（见七.5 回滚），
所以这一节是「先恢复登录，再慢慢修 Casdoor」的顺序，不是二选一。

### 七.0 三条路怎么选

| 方案 | 谁动手 | 代码改动 | 说明 |
| --- | --- | --- | --- |
| **A. 修 Casdoor**（首选，30 秒） | 服务器管理员，仅点几下 UI | 无 | 在 Casdoor 里编辑 `agenttrust-google`，把 provider 项 `provider_google` 的 **SignIn** 勾上（GitHub 同理）。**登录方式不变，老用户完全不受影响** |
| **B. Google 直连** | 需要 Google Cloud Console 权限 | 无（只改 env） | `oidc.ts` 是 provider 无关的（`oidc.discovery(new URL(issuer))`），把 issuer 指向 `https://accounts.google.com` 就能用 |
| **C. GitHub 直连** | 需要 GitHub 账号建 OAuth App | 已内置（`auth-bff/src/github-direct.ts`） | GitHub OAuth App **不是 OIDC**（无 discovery 端点、不发 `id_token`），所以必须手写 OAuth2 流程，不能只改 issuer |

建议顺序：先试 A（零成本、零副作用）；A 不可达时用 B + C 先把登录救回来。

### 七.1 Google 直连：只改 env

1. 在 [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
   建一个 **OAuth client ID**（类型 Web application）。
2. **Authorized redirect URI** 填：
   `https://agenttrust.site/api/auth/oidc/google/callback`
   （与中转模式完全同一个回调地址，Caddy 和前端都不用动）
3. 把 `/etc/agenttrust/auth-bff-production.env` 里的四个 `GOOGLE_OIDC_*` 改成：

   ```
   GOOGLE_OIDC_ISSUER=https://accounts.google.com
   GOOGLE_OIDC_CLIENT_ID=<Google 签发的 client id>
   GOOGLE_OIDC_CLIENT_SECRET=<Google 签发的 client secret>
   GOOGLE_OIDC_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/google/callback
   ```

4. 按第二节部署（先 migrate 再 restart）。不需要改任何代码。

### 七.2 GitHub 直连：建 OAuth App + 三项 env

1. 在 [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
   点 **New OAuth App**：

   | 字段 | 值 |
   | --- | --- |
   | Application name | `AgentTrust` |
   | Homepage URL | `https://agenttrust.site` |
   | Authorization callback URL | `https://agenttrust.site/api/auth/oidc/github/callback` |

2. 建好后拿 **Client ID**，点 **Generate a new client secret**（**只显示一次**）。
3. 在 BFF env 里**新增**三项（不要动 `GITHUB_OIDC_*`，留着方便回滚）：

   ```
   GITHUB_OAUTH_CLIENT_ID=<GitHub Client ID>
   GITHUB_OAUTH_CLIENT_SECRET=<GitHub client secret>
   GITHUB_OAUTH_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/github/callback
   ```

4. 按第二节部署（先 migrate 再 restart）。

**互斥规则**：`GITHUB_OAUTH_*` 三项齐全时，`GITHUB_OIDC_*` 会被 BFF 自动视为未配置
（见 `auth-bff/src/config.ts` 的 `oauthBypass`），两条路径不会同时生效。
前端按钮也**不会**消失：`/api/auth/capabilities` 会把直连计入 `oidc.github.configured`。

代码行为要点（`auth-bff/src/github-direct.ts`）：

- 路由仍是 `/api/auth/oidc/github/start` 与 `/api/auth/oidc/github/callback`，前端零改动。
- token 交换带 `Accept: application/json`（否则 GitHub 返回 200 + urlencoded 错误体，
  看起来像成功），所有 GitHub 调用带 `User-Agent`（匿名请求会被 403）。
- `allow_signup=false`，关掉 GitHub 授权页的"注册新账号"入口。
- 主邮箱未公开时回落到 `/user/emails` 取 `primary && verified`。
- 身份主键：`issuer = github:direct`、`subject = GitHub 数字 ID`。

### 七.3 身份兼容性：切换路径会开新账号（重要）

`oidc_identities` 的主键是 `UNIQUE (issuer, subject)`。切换登录路径等于换了 issuer，
**老用户会以新身份再开一个账号**，钱包绑定和交易历史不会自动跟过来。

| 路径 | issuer | subject | 能否平滑迁移 |
| --- | --- | --- | --- |
| Casdoor 中转 | `https://login.agenttrust.site` | Casdoor 内部用户 ID | — |
| Google 直连 | `https://accounts.google.com` | Google 的 `sub` | **可以**：subject 不变，只换 issuer |
| GitHub 直连 | `github:direct` | GitHub 数字 ID | **不行**：Casdoor 里的 subject 是 Casdoor 自己的 ID，与 GitHub 数字 ID 无映射 |

所以：

- **Google**：若已有一批 Casdoor 中转用户，切直连后跑一条 UPDATE 即可并回原账号：
  ```sql
  UPDATE oidc_identities
     SET issuer = 'https://accounts.google.com'
   WHERE provider = 'google'
     AND issuer = 'https://login.agenttrust.site';
  ```
  ⚠️ 执行前先 `BEGIN;` 看 `rowCount`，确认无误再 `COMMIT;`。
- **GitHub**：只能让用户重新绑定（或从 Casdoor 导出 GitHub 外部 ID 做映射后批量改写 subject）。
- **结论**：不要在两条路径之间来回切。一旦切到直连，就当它是最终态。

### 七.4 验证

```bash
# 1) BFF 认为 GitHub 可用（直连也会被计入 configured）
curl -s https://agenttrust.site/api/auth/capabilities | jq '.oidc'

# 2) 点登录按钮后跳转的域名
#    Google 直连 → accounts.google.com
#    GitHub 直连 → github.com/login/oauth/authorize
#    仍是中转   → login.agenttrust.site   ← 说明 env 没生效
```

### 七.5 回滚到 Casdoor 中转

删掉 BFF env 里的三项 `GITHUB_OAUTH_*`（Google 则把 issuer 改回
`https://login.agenttrust.site` 并把 client id/secret 换回 Casdoor 签发的），重启 BFF 即可。
**不需要数据库回滚**，也不需要动前端——路由地址从头到尾没变过。

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
