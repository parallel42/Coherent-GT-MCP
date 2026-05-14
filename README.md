# CoherentGT MCP

Dockerized MCP server for inspecting and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

- Host debugger: `http://127.0.0.1:19999/pagelist.json`
- Docker debugger URL: `http://host.docker.internal:19999`
- Transports: MCP stdio, or shared Streamable HTTP on `/mcp`
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

#### Shared HTTP Server (Recommended For Codex)

Run one shared Docker container:

```powershell
docker run -d `
  --name coherent-gt-mcp-shared `
  -p 3333:3333 `
  -e COHERENT_GT_TRANSPORT=http `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  ghcr.io/parallel42/coherent-gt-mcp:latest
```

Codex TOML:

```toml
[mcp_servers.coherent-gt-mcp]
url = "http://127.0.0.1:3333/mcp"
```

All Codex sessions that use this URL connect to the same container and share persistent debugger session state. Check the shared server with:

```powershell
Invoke-RestMethod http://127.0.0.1:3333/health
```

Stop it with:

```powershell
docker stop coherent-gt-mcp-shared
```

If the shared container has exited after being idle, start the same named container again:

```powershell
docker start coherent-gt-mcp-shared
```

#### Stdio Per Client

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

Do not set a fixed Docker `--name` in stdio MCP client configurations. Stdio clients start the server as a subprocess, and a named container can block future agent starts if a previous process is still running or did not shut down cleanly. Use `--name` only for one-off manual debugging commands or for the shared HTTP container you manage explicitly.

## Update

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

Restart the agent after pulling the new image.

## Configuration

| Variable | Default |
| --- | --- |
| `COHERENT_GT_TRANSPORT` | `stdio` |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` |
| `COHERENT_GT_WS_TIMEOUT_MS` | `30000` |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` |
| `COHERENT_GT_IDLE_TIMEOUT_MS` | `3000000` |
| `COHERENT_GT_HTTP_HOST` | `0.0.0.0` |
| `COHERENT_GT_HTTP_PORT` | `3333` |
| `COHERENT_GT_HTTP_PATH` | `/mcp` |

`COHERENT_GT_DEBUGGER_URL` uses `host.docker.internal` because the server runs inside Docker. `COHERENT_GT_IDLE_TIMEOUT_MS` applies to stdio and shared HTTP modes and defaults to 50 minutes; set it to `0` to disable automatic shutdown.

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Runtime/control: JavaScript eval, engine calls/events, clicks, reloads, and navigation
- DOM/CSS/resources: document, selector, style, stylesheet, resource, and native inspector helpers
- Debugger: persistent debug sessions, script search, breakpoints, pause/resume, stepping, and call-frame evaluation
- Profiling: legacy timeline/script/network/heap/layer captures, compact summaries, raw payload lookup, and paint/compositing overlays

Quick profiling flow:

```text
coherentgt_capture_all_start({ "pageId": 31, "reload": true })
coherentgt_capture_all_stop({ "pageId": 31 })
coherentgt_profile_raw({ "pageId": 31, "rawId": "<rawId from summary>" })
```

Use focused tools such as `coherentgt_timeline_start`, `coherentgt_network_capture_start`, `coherentgt_heap_snapshot`, and `coherentgt_set_paint_rects_visible` when you only need one diagnostic surface.

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, navigate, profile, and toggle diagnostic overlays in live views. Use only on local development targets you control.
