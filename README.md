# CoherentGT MCP

Dockerized stdio MCP server for inspecting and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

- Host debugger: `http://127.0.0.1:19999/pagelist.json`
- Docker debugger URL: `http://host.docker.internal:19999`
- Transport: MCP stdio, no exposed Docker ports
- Scope: debugger HTTP + WebKit Inspector endpoints

## Quick Start

### 1. Start Docker Desktop

If Docker is not installed:

```powershell
winget install --id Docker.DockerDesktop -e
```

Verify Docker:

```powershell
docker version
```

### 2. Start MSFS

Verify the Coherent debugger endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:19999/pagelist.json
```

### 3. Pull the Image

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

### 4. Add the MCP Server

JSON clients:

```json
{
  "mcpServers": {
    "coherent-gt-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999",
        "ghcr.io/parallel42/coherent-gt-mcp:latest"
      ]
    }
  }
}
```

Codex TOML:

```toml
[mcp_servers.coherent-gt-mcp]
command = "docker"
args = [
  "run",
  "--rm",
  "-i",
  "-e",
  "COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999",
  "ghcr.io/parallel42/coherent-gt-mcp:latest"
]
```

Restart the agent, then call `coherentgt_health` and `coherentgt_list_views`.

Do not set a fixed Docker `--name` in MCP client configurations. MCP clients start the server as a stdio subprocess, and a named container can block future agent starts if a previous process is still running or did not shut down cleanly. Use `--name` only for one-off manual debugging commands where you also manage container cleanup yourself.

## Update

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

Restart the agent after pulling the new image.

## Configuration

| Variable | Default |
| --- | --- |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` |
| `COHERENT_GT_WS_TIMEOUT_MS` | `30000` |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` |
| `COHERENT_GT_IDLE_TIMEOUT_MS` | `3000000` |

`COHERENT_GT_DEBUGGER_URL` uses `host.docker.internal` because the server runs inside Docker. `COHERENT_GT_IDLE_TIMEOUT_MS` defaults to 50 minutes; set it to `0` to disable automatic shutdown.

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Runtime/control: JavaScript eval, engine calls/events, clicks, reloads, and navigation
- DOM/CSS/resources: document, selector, style, stylesheet, resource, and native inspector helpers
- Debugger: persistent debug sessions, script search, breakpoints, pause/resume, stepping, and call-frame evaluation

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, and navigate live views. Use only on local development targets you control.
