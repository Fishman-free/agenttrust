# MCP / A2A Endpoint Setup Guide

> Chinese version (primary): [docs/guides/mcp-a2a-endpoints.zh-CN.md](./mcp-a2a-endpoints.zh-CN.md)
>
> Three stages: **run it locally → expose it over public https → register it on AgentTrust**.

## 0. Hard rule — only this shape of endpoint is accepted (everything else is rejected)

| Rule | How it's checked | What happens if you break it |
| --- | --- | --- |
| Protocol must be `https://` | `URL.protocol === "https:"` | Form errors with "endpoint invalid" — submit is blocked |
| Host must be a public-reachable domain | Host not on the private blocklist AND host contains `.` | Same — submit is blocked |
| The endpoint is **immutable after registration** | Contract `AgentInfo.endpoint` has no setter | A typo means a brand-new identity; deposit is withdrawable per deregistration rules |

**Full private-network blocklist** (mirrors `isPublicEndpoint` in the registration form — don't try to bypass):

| Kind | Examples |
| --- | --- |
| Literal | `localhost`, `::1`, `0.0.0.0` |
| IPv4 loopback | `127.x.x.x` (any) |
| IPv4 private | `10.x.x.x`, `192.168.x.x`, `172.16.x.x` – `172.31.x.x` |
| Special suffixes | `*.localhost`, `*.local`, `*.internal`, `*.home.arpa` |

> **Why `0.0.0.0` is on the list**: it's the "bind to all interfaces" address, not a routable destination. Linux maps it to `127.0.0.1`, Windows / macOS just fail. Registering it produces a permanently dead identity. Binding your service to `0.0.0.0:8123` is still fine — just register with the public domain you expose it under.

### Zero-server, zero-config quickstart (try this first)

**Cloudflare Tunnel (cloudflared quick tunnel)** — one command, no signup, gives you a `https://*.trycloudflare.com` URL with HTTPS auto-issued. Use this to verify the handshake before deciding whether to wire up your own domain.

```bash
# 1. Install cloudflared (macOS / Linux)
brew install cloudflared      # macOS
# Linux: grab a binary at https://github.com/cloudflare/cloudflared/releases

# 2. Assume your MCP server listens on 127.0.0.1:8123
cloudflared tunnel --url http://127.0.0.1:8123
# Output looks like: https://some-random-word-1234.trycloudflare.com
# Copy that URL — that is your public endpoint.

# 3. Probe (must return JSON with `serverInfo` before you register)
curl -i -X POST https://some-random-word-1234.trycloudflare.com/mcp \
   -H "Content-Type: application/json" \
   -H "Accept: application/json, text/event-stream" \
   -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'

# 4. Paste the full https URL into the registration form (must include the `/mcp` path)
```

**Note**: a quick-tunnel domain is regenerated on every restart — for a stable name bind your own domain (see section 4, Caddy path). The probe first; register only once the handshake works.

---

## 1. What an endpoint is

An endpoint is an ordinary `https://` URL that answers MCP / A2A protocol requests instead of web pages.

| Type | What it is |
| --- | --- |
| MCP endpoint `https://your.domain/mcp` | Tool service address — other programs call your tools there |
| A2A endpoint `https://your.domain/a2a` | Agent card + meeting room (A2A = Agent-to-Agent): who you are, what you can do |

No address means nobody finds you; a wrong address (a private-network one, say) is equally unreachable.

## 2. Run it locally

Fastest path is Python's FastMCP:

```python
# server.py
from fastmcp import FastMCP

mcp = FastMCP("MyAgent")

@mcp.tool
def get_price(symbol: str) -> str:
    """Look up a token price (sample tool)."""
    return f"{symbol} = 100 USD"

mcp.run()  # stdio mode: verify tool logic locally first
```

```bash
pip install fastmcp
python server.py
```

Node users: `npm i @modelcontextprotocol/sdk` — same idea. Get it working locally before you deploy anything.

## 3. Wire it into the agent you already use (pick one)

One goal: make `https://your.domain/mcp` a real, reachable, verified MCP service.

### Path A — Claude Code (Anthropic CLI)

```bash
npm install -g @anthropic-ai/claude-code   # Node.js 18+
claude                                     # interactive session in any project directory
claude mcp add --transport http my-agent https://agent.example.com/mcp
claude mcp list                            # registered servers
```

Or commit it to the repo as `.mcp.json`:

```json
{
  "mcpServers": {
    "my-agent": { "type": "http", "url": "https://agent.example.com/mcp" }
  }
}
```

Verify: type `/mcp` in the session — `my-agent` should be connected with `get_price` listed; call the tool once to confirm end to end.

> Claude Code is an interactive CLI, not a resident HTTP service. To make it your agent, use it to build and run your own MCP server (Path C) — don't expose the CLI process itself.

### Path B — Codex CLI (OpenAI)

```bash
npm install -g @openai/codex
codex
```

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.my-agent]
url = "https://agent.example.com/mcp"
```

Verify: restart `codex` and call one of your tools; `codex mcp --help` lists the management subcommands your build supports.

> ⚠️ Codex's MCP transport support moves fast — use the latest version, and if the connection fails confirm your server speaks streamable HTTP. Older builds only accept local stdio: `command = "python", args = ["server.py"]`.

### Path C — Build your own agent (Python / Node.js)

Python: switch the call from section 2 to public mode.

```python
mcp.run(transport="http", host="0.0.0.0", port=8000)   # older FastMCP: transport="streamable-http"
```

Node.js / TypeScript:

```bash
npm install @modelcontextprotocol/sdk zod
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "MyAgent", version: "0.1.0" });
server.tool("get_price", { symbol: z.string() }, async ({ symbol }) => ({
  content: [{ type: "text", text: `${symbol} = 100 USD` }],
}));
// mount the streamable HTTP transport in your HTTP layer (Express/Hono) and start
```

**Adding A2A (optional)**: serve `https://your.domain/.well-known/agent.json` with name, capabilities and endpoints.

**Debugging**: `npx @modelcontextprotocol/inspector` — connect to your URL and see tools and call results visually.

## 4. Expose it publicly

Deploy to a machine with a public IP and terminate HTTPS in front (Caddy, two lines, automatic TLS):

```
agent.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

No server? Railway / Fly.io / cloud functions hand you an https domain directly.

| Requirement | Why |
| --- | --- |
| `https://` | Plain http is wide open; the registration page only accepts https |
| Publicly reachable | `localhost`, `127.0.0.1`, `192.168.x.x` are unreachable for other agents |
| Stable domain | Endpoints are **immutable after registration** — no throwaway addresses |

## 5. Probe it yourself

```bash
# 1. reachability and certificate (a 4xx still means the service answered)
curl -i https://agent.example.com/mcp

# 2. MCP handshake (streamable HTTP needs POST + JSON-RPC)
curl -i -X POST https://agent.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
```

A JSON reply containing `serverInfo` means it works publicly. For A2A, `GET /.well-known/agent.json` should return the agent card.

## 6. Register on AgentTrust

1. Sign in at agenttrust.site → **Agent Registration**;
2. Paste your verified `https://agent.example.com/mcp` into the MCP/A2A endpoint field;
3. Three rules to remember:
   - The endpoint is **immutable on-chain** (no setter on `AgentInfo.endpoint`) — a typo means registering a new identity;
   - An endpoint is **not an identity** — anyone can register the same URL, it proves no ownership;
   - The globally unique anchors are the **ATID** (ERC-721 token id) and the **(platform, externalAgentId) binding**. Complete the L1 binding after registration, then upgrade to L2–L4 proofs.

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Connection refused` / timeout | Not bound to 0.0.0.0, or firewall closed | Check bind address and security group |
| Works in browser, curl reports certificate error | Cert doesn't cover the host | Use Caddy automatic TLS |
| Fine locally, 502 in public | Wrong upstream port | Verify the `reverse_proxy` target |
| Want to change the endpoint later | Endpoints are immutable | Register a new identity; deposit is withdrawable per deregistration rules |
| Private IP rejected | Registration-page validation | Use a public https domain |
| `/mcp` doesn't show your server in Claude Code | Not registered, or wrong scope | Re-add with `claude mcp add`; mind `--scope` (user = global / project = this repo) |
| Claude Code reports `Transport error` | Not streamable HTTP, or proxy strips POST | Re-run the curl initialize probe from section 5 |
| Codex can't reach the HTTP server | Older build without `url` support | Upgrade Codex, or bridge via local stdio for now |

---

*Questions? Open an issue: https://github.com/Fishman-free/multiagent*
