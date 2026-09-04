# MCP / A2A Endpoint Setup Guide (Beginner-Friendly)

> Chinese version (primary): [docs/guides/mcp-a2a-endpoints.zh-CN.md](./mcp-a2a-endpoints.zh-CN.md)
>
> This is the English companion of the same tutorial. After reading it you can answer:
> **What is an endpoint? How do I expose one publicly? What should I watch out for when registering on AgentTrust?**

## 1. The analogy: an endpoint is your shop address

- **MCP endpoint** = your shop's street address. Other programs (Claude, other agents) walk up to it and use your tools (fetch data, place orders, compute...).
- **A2A endpoint** = your business card + meeting room. Other agents read it to learn who you are, what you can do, and how to negotiate (A2A = Agent-to-Agent).

```
 User / other agent
      │  visits the "address"
      ▼
 https://your.domain/mcp   ← MCP endpoint (tool service)
 https://your.domain/a2a   ← A2A endpoint (agent card & conversation)
      │
      ▼
 Your agent (calls tools, returns results)
```

In short: **an endpoint is an ordinary https:// URL that answers MCP / A2A protocol requests instead of web pages.**

## 2. Step 1 — Run MCP locally

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

Node users: `npm i @modelcontextprotocol/sdk` — same idea.

## 2.5 Wire it into the agent you already use

The endpoint is running — now pick the path that matches your agent. All three paths share one goal:

> Make `https://your.domain/mcp` a real, reachable, verified MCP service.

### Path A — Claude Code (Anthropic CLI)

For: you already work inside Claude Code and want it to call your own tools.

**1. Open the agent**

```bash
# install (Node.js 18+)
npm install -g @anthropic-ai/claude-code
# start an interactive session in any project directory
claude
```

**2. Connect your MCP endpoint**

```bash
# run inside Claude Code (or prefix with `claude` in a terminal):
claude mcp add --transport http my-agent https://agent.example.com/mcp

# management
claude mcp list
claude mcp remove my-agent
```

Or commit it to your repo as `.mcp.json`:

```json
{
  "mcpServers": {
    "my-agent": { "type": "http", "url": "https://agent.example.com/mcp" }
  }
}
```

**3. Verify**

Type `/mcp` inside the Claude Code session — `my-agent` should be connected with your tools listed; ask it to call one ("look up the ETH price") to confirm end to end.

> Want **Claude Code itself** to be your public agent endpoint? It is an interactive CLI, not a resident HTTP service. The simple path: use Claude Code to develop and run your own MCP server (Path C), rather than exposing the Claude Code process directly.

### Path B — Codex CLI (OpenAI)

For: you work in OpenAI's Codex CLI.

**1. Open the agent**

```bash
npm install -g @openai/codex
codex    # interactive session; first run walks you through sign-in / API key setup
```

**2. Configure MCP**

Edit (or create) `~/.codex/config.toml`:

```toml
# newer versions accept an HTTP endpoint directly (streamable HTTP)
[mcp_servers.my-agent]
url = "https://agent.example.com/mcp"

# older builds only support local stdio commands; run your server locally
# (command = "python", args = ["server.py"]) or bridge the remote endpoint
```

**3. Verify**

Restart `codex` and call one of your tools; use `codex mcp --help` to see what management subcommands your build supports.

> ⚠️ Codex's MCP transport support moves fast. Use the latest version; if the connection fails, first confirm your server speaks streamable HTTP.

### Path C — Build your own agent (Python / Node.js)

For: you are writing your own agent program and want a real public service.

**Python (FastMCP)**

```python
# server.py — a complete MCP service in a dozen lines
from fastmcp import FastMCP

mcp = FastMCP("MyAgent")

@mcp.tool
def get_price(symbol: str) -> str:
    """Look up a token price (sample tool)."""
    return f"{symbol} = 100 USD"

# public mode: listen on all interfaces, Caddy terminates https in front
mcp.run(transport="http", host="0.0.0.0", port=8000)
```

**Node.js / TypeScript (official SDK)**

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

**Adding A2A (optional)**: A2A is the agent-to-agent negotiation protocol. Minimal version: serve `https://your.domain/.well-known/agent.json` describing name, capabilities and endpoints; community A2A SDKs (Python/JS) can run a full standard agent service.

**Debugging**: `npx @modelcontextprotocol/inspector` — the official Inspector connects to your URL and shows tools and call results visually.

## 3. Step 2 — Expose it publicly

```python
mcp.run(transport="http", host="0.0.0.0", port=8000)
```

Deploy to a machine with a public IP and put HTTPS in front (Caddy is easiest):

```
agent.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

No server? Use Railway / Fly.io / cloud functions — they hand you an https domain.

**Checklist (all required):** `https://` · publicly reachable (no `localhost`, `127.0.0.1`, or private IPs) · a stable domain — **endpoints can never be changed after registration**.

## 4. Step 3 — Probe it yourself

```bash
curl -i https://agent.example.com/mcp

curl -i -X POST https://agent.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0.0.1"}}}'
```

A JSON response containing `serverInfo` means your MCP service works publicly. For A2A, `GET /.well-known/agent.json` should return the agent card JSON.

## 5. Step 4 — Register on AgentTrust

1. Sign in at agenttrust.site → **Agent Registration**.
2. Paste your verified `https://agent.example.com/mcp` into the MCP/A2A endpoint field.
3. Three rules to remember:
   - The endpoint is **immutable on-chain** after registration (no setter on `AgentInfo.endpoint`).
   - An endpoint is **not an identity** — anyone can register the same URL, and it proves no ownership.
   - The globally unique anchors are the **ATID** (ERC-721 token id) and the **(platform, externalAgentId) binding**. Complete the L1 binding after registration, then upgrade to L2–L4 proofs.

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Connection refused` / timeout | Not listening on 0.0.0.0, or firewall closed | Check bind address and security group |
| Certificate errors | Cert doesn't cover the host | Use Caddy automatic TLS |
| 502 behind proxy | Wrong upstream port | Verify `reverse_proxy` target |
| Want to change endpoint later | Endpoints are immutable | Register a new identity; deposit is withdrawable per deregistration rules |
| Private IP rejected | Registration-page validation | Use a public https domain |
| `/mcp` doesn't show your server in Claude Code | Not registered, or wrong scope | Re-add with `claude mcp add`; mind `--scope` (user = global / project = this repo) |
| Claude Code reports `Transport error` | Endpoint isn't streamable HTTP, or proxy strips POST | Re-run the curl initialize probe from Step 3 |
| Codex can't reach the HTTP server | Older build without `url` support | Upgrade Codex; or bridge via local stdio for now |

---

*Questions? Open an issue: https://github.com/Fishman-free/multiagent*
