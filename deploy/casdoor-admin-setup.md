# Casdoor 中转登录：管理员部署清单

这份清单给**服务器管理员**执行。开发用的 `agenttrust-dev` SSH 账号是受限的前端发布号
（无 Docker、无 Casdoor 访问权、无 `/etc/agenttrust` 读权限、禁止端口转发），
因此下面这些步骤**必须**由管理员本人完成。

代码侧已经就绪（PR #39 已合并进 `main`）：Auth BFF 把 Google 和 GitHub 都当作**标准 OIDC
provider**，生产上它们的 `issuer` 都指向 Casdoor 实例，由 Casdoor 完成真实的 Google/GitHub 授权。
BFF 不再直连 Google/GitHub，也不持有它们的原生凭据。

---

## 零、开始前必读：回调地址要改

这是最容易踩的坑，请先确认。

队友之前在 Google Cloud Console / GitHub OAuth Apps 里登记的回调地址是：

```
https://agenttrust.site/api/auth/oidc/google/callback
https://agenttrust.site/api/auth/oidc/github/callback
```

那是**给「BFF 直连」方案用的**。改成 Casdoor 中转后，Google/GitHub 不再回调 BFF，
而是**先回调 Casdoor**，再由 Casdoor 回调 BFF。所以原生凭据里的回调必须改成 Casdoor 的地址：

```
https://login.agenttrust.site/callback/google
https://login.agenttrust.site/callback/github
```

具体值以 Casdoor 创建 provider 时页面上显示的「回调地址」为准（第三步、第四步会拿到）。
不改会报 `redirect_uri_mismatch`。

---

## 一、前置条件

- Casdoor 未部署（`deploy/casdoor.compose.example.yml` 目前只是示例文件）
- 已拿到队友提供的 Google 与 GitHub 原生 client id / secret
- 有服务器 root/管理员权限、可操作 Docker 与 `/etc/agenttrust`

## 二、部署 Casdoor

参考 `deploy/casdoor.compose.example.yml` 与 `deploy/casdoor.env.example`：

1. 复制 `casdoor.env.example` 到仓库外，设置随机数据库口令，`chmod 600`。
2. 用 `casdoor.compose.example.yml` 起 Casdoor（示例里已固定 `casbin/casdoor:v3.161.1`，
   数据库与端口保持私有、不对外暴露）。
3. 反向代理挂到 `login.agenttrust.site`（HTTPS）。

**上线后立刻做**（`docs/authentication.md` 有同样的要求）：

- [ ] 改掉默认管理员口令（`admin` / `123`），强制开启 MFA
- [ ] 关闭公开的自注册（除非明确需要）
- [ ] 确认 Casdoor 里**不存在**任何 MetaMask / Web3 / Web3-Onboard provider
- [ ] 管理界面按 IP 或 VPN 限制访问
- [ ] 备份 Casdoor 数据库并演练一次恢复

## 三、在 Casdoor 里配 Google provider

管理后台 → 提供商（Providers）→ 添加：

| 字段 | 值 |
|---|---|
| 类别（Category） | OAuth |
| 类型（Type） | Google |
| 名称（Name） | `google` |
| Client ID | 队友给的 Google 原生 client id |
| Client Secret | 队友给的 Google 原生 client secret |

保存后，**记下页面上显示的回调地址**（形如 `https://login.agenttrust.site/callback/google`），
去 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 把它填进
该 OAuth 客户端的「已获授权的重定向 URI」。

## 四、在 Casdoor 里配 GitHub provider

同样路径 → 添加：

| 字段 | 值 |
|---|---|
| 类别 | OAuth |
| 类型 | GitHub |
| 名称 | `github` |
| Client ID | 队友给的 GitHub 原生 client id |
| Client Secret | 队友给的 GitHub 原生 client secret |

记下回调地址（形如 `https://login.agenttrust.site/callback/github`），
到 GitHub → Settings → Developer settings → OAuth Apps 里把它填进
「Authorization callback URL」。

## 五、建两个 Casdoor 应用（关键，不要合并成一个）

BFF 里 `google` 和 `github` 是两个独立的 OIDC provider，各有独立的
issuer / client id / secret / redirect URI。所以在 Casdoor 里建**两个应用**，
各自只挂一个 provider —— 这样点「Google」按钮只会看到 Google 登录，
点「GitHub」按钮只会看到 GitHub 登录，不需要在 Casdoor 登录页再选一次。

> 另一个办法是建一个应用、用 `provider_hint=google|github` 参数跳过 Casdoor 的
> provider 选择页，但那需要改 BFF 代码。当前代码走的是双应用方案，无需改动。

### 应用 A：`agenttrust-google`

| 字段 | 值 |
|---|---|
| 名称 | `agenttrust-google` |
| 组织 | `built-in` |
| 重定向 URL | `https://agenttrust.site/api/auth/oidc/google/callback` |
| 授权类型 | Authorization Code（勾选） |
| 提供商（Providers） | **只勾** `google` |
| 开启密码登录 | 关（只走社交登录） |
| 开启注册 | 按需，建议关 |

保存后记下 **Client ID** 与 **Client Secret**。

### 应用 B：`agenttrust-github`

| 字段 | 值 |
|---|---|
| 名称 | `agenttrust-github` |
| 组织 | `built-in` |
| 重定向 URL | `https://agenttrust.site/api/auth/oidc/github/callback` |
| 授权类型 | Authorization Code（勾选） |
| 提供商（Providers） | **只勾** `github` |
| 开启密码登录 | 关 |
| 开启注册 | 按需，建议关 |

保存后记下 **Client ID** 与 **Client Secret**。

## 六、把 Casdoor 凭据填进生产 BFF 的 `.env`

生产 Auth BFF 的环境文件（在 `/etc/agenttrust` 下，路径以实际部署为准）里填这 8 项：

```bash
# 两个应用的 issuer 相同，都指向 Casdoor 实例
GOOGLE_OIDC_ISSUER=https://login.agenttrust.site
GOOGLE_OIDC_CLIENT_ID=<应用 A 的 Client ID>
GOOGLE_OIDC_CLIENT_SECRET=<应用 A 的 Client Secret>
GOOGLE_OIDC_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/google/callback

GITHUB_OIDC_ISSUER=https://login.agenttrust.site
GITHUB_OIDC_CLIENT_ID=<应用 B 的 Client ID>
GITHUB_OIDC_CLIENT_SECRET=<应用 B 的 Client Secret>
GITHUB_OIDC_REDIRECT_URI=https://agenttrust.site/api/auth/oidc/github/callback
```

要点：

- **四项齐全才算配置完成**（issuer + client id + secret + redirect URI），缺任一项该 provider
  都会返回 `503 provider_not_configured`，前端显示「需要配置」而非无限「配置中」。
- 这四个值**都是 Casdoor 签发的**，不是 Google/GitHub 官方控制台的原生凭据。
  原生凭据只存在于 Casdoor 后台（第三步、第四步），永远不要写进 BFF 的 `.env` 或 git。
- `AUTH_ORIGINS` 在生产**留空** —— 公网入口只应保留 `https://agenttrust.site` 一个 Origin。
- `NODE_ENV=production` 时 `COOKIE_SECURE` 必须为 `true`，且 `COOKIE_NAME` 要以 `__Host-` 开头。

## 七、重启并验证

```bash
sudo agenttrust-restart-auth
sudo agenttrust-logs-auth
```

按顺序验证：

1. `curl https://agenttrust.site/api/auth/capabilities`
   应看到 `oidc.google.configured` 与 `oidc.github.configured` 都是 `true`。
2. 打开 `https://agenttrust.site/login/`，两个按钮应显示「继续登录」而不是「需要配置」。
3. 点 Google 按钮 → 应直接跳到 Google 授权页（不出现 Casdoor 的 provider 选择页）。
4. 授权后回到 `https://agenttrust.site/agents/` 且已登录。
5. GitHub 按钮重复 3–4 步。
6. 确认钱包登录不受影响（PR #37 修复的 Origin 白名单与 SIWE nonce 问题）。

## 八、出问题时

- **按钮仍显示「需要配置」**：某个 provider 的四项 env 有缺失，重启后看
  `sudo agenttrust-logs-auth` 里有没有 `provider_not_configured`。
- **Google 报 `redirect_uri_mismatch`**：第「零」步的原生回调没改成 Casdoor 的 `/callback/google`。
- **Casdoor 报回调不匹配**：检查第五步应用里的重定向 URL 是否逐字符一致（含结尾无斜杠）。
- **登录成功但没跳转**：`RETURN_TO_ORIGINS` 需包含 `https://agenttrust.site`。
- **回滚**：把第六步的 8 项 env 清空并重启 BFF，会 fail closed 回「需要配置」状态，
  钱包登录不受影响。
