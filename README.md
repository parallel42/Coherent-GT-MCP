# CoherentGT MCP

Dockerized MCP server for inspecting and controlling live Coherent GT UI views through the Coherent debugger service.

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

### 2. Start A Coherent GT Host

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

For Codex, use the launcher/proxy script so every session uses one shared Docker MCP instance without manually starting the container first:

```toml
[mcp_servers.p42-coherentgt-mcp]
command = "node"
args = ['F:\Documents\Clients\Parallel 42\Git\p42-coherentgt-mcp\scripts\codex-shared-mcp-proxy.mjs']
```

The proxy creates or starts a named `coherent-gt-mcp-shared` Docker container, connects to `http://127.0.0.1:3333/mcp`, and forwards Codex MCP traffic to that shared instance. The shared container exits after `COHERENT_GT_IDLE_TIMEOUT_MS` without requests and will be started again automatically by the next Codex session or tool call.

When the named container is stopped, the proxy compares its image ID with the configured image tag and recreates the container if the tag now points at a newer local image. A running shared container is left alone so active agents keep the same instance.

Manual shared-container command, if you want to run it yourself:

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

All active Codex sessions that use this URL connect to the same container and share persistent debugger session state. When the last MCP HTTP session disconnects, the server closes retained Coherent WebInspector sockets so the standalone Coherent Debugger can attach. Check the shared server with:

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

Restart the agent after pulling the new image. MCP clients usually cache tool metadata for the lifetime of a session, so a session that started before the image update can still report the older limited tool set even when the shared HTTP endpoint is already current.

## Configuration

| Variable | Default |
| --- | --- |
| `COHERENT_GT_TRANSPORT` | `stdio` |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` |
| `COHERENT_GT_WS_TIMEOUT_MS` | `30000` |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` |
| `COHERENT_GT_INLINE_RESULT_BYTES` | `32768` |
| `COHERENT_GT_RESULT_PREVIEW_BYTES` | `12000` |
| `COHERENT_GT_RESULT_CHUNK_BYTES` | `16000` |
| `COHERENT_GT_HOST_HELPER_URL` | unset |
| `COHERENT_GT_HOST_HELPER_PROCESS_NAMES` | unset |
| `COHERENT_GT_HOST_HELPER_LOG_ROOTS` | unset |
| `COHERENT_GT_HOST_HELPER_RESOURCE_ROOTS` | unset |
| `COHERENT_GT_IDLE_TIMEOUT_MS` | `3000000` |
| `COHERENT_GT_HTTP_HOST` | `0.0.0.0` |
| `COHERENT_GT_HTTP_PORT` | `3333` |
| `COHERENT_GT_HTTP_PATH` | `/mcp` |

`COHERENT_GT_DEBUGGER_URL` uses `host.docker.internal` because the server runs inside Docker. `COHERENT_GT_IDLE_TIMEOUT_MS` applies to stdio and shared HTTP modes and defaults to 50 minutes; set it to `0` to disable automatic shutdown.

Oversized tool replies are cached in memory and returned as a small preview with a `resultId`. Use `coherentgt_result_read` to read bounded byte ranges from the cached reply, or `coherentgt_result_search` to find compact match snippets without loading the full payload into the agent context. `COHERENT_GT_INLINE_RESULT_BYTES` controls when this kicks in, `COHERENT_GT_RESULT_PREVIEW_BYTES` controls the initial preview size, and `COHERENT_GT_RESULT_CHUNK_BYTES` controls the default follow-up read size.

Optional host process/log/resource correlation is available through a read-only Windows helper:

```powershell
$env:COHERENT_GT_HOST_HELPER_LOG_ROOTS = "C:\Path\To\Logs|D:\OtherLogs"
$env:COHERENT_GT_HOST_HELPER_RESOURCE_ROOTS = "C:\Path\To\Resources|D:\OtherResources"
npm run host-helper
```

Point the Docker MCP server at it with `COHERENT_GT_HOST_HELPER_URL=http://host.docker.internal:3344`. Process names, log roots, and local resource roots are allowlists; when the helper is not configured, diagnostic tools return an explicit unavailable reason.

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Generic diagnostics: `coherentgt_list_pages`, `coherentgt_evaluate`, `coherentgt_console_snapshot`, `coherentgt_runtime_errors`, `coherentgt_page_health`, `coherentgt_network_snapshot`, `coherentgt_event_listeners`, `coherentgt_trace_events`, `coherentgt_diagnose_page`
- Cached large replies: `coherentgt_result_read`, `coherentgt_result_search`
- Session cleanup: `coherentgt_release_page`, `coherentgt_release_all`
- Runtime/control: JavaScript eval, engine calls/events, clicks, reloads, and navigation
- DOM/CSS/resources: document, selector, style, stylesheet, resource, native inspector helpers, `coherentgt_inspect_selector`, `coherentgt_probe_resource`, and `coherentgt_probe_image`
- Debugger: persistent debug sessions, script search, breakpoints, pause/resume, stepping, and call-frame evaluation
- Profiling: capabilities guidance, legacy timeline/script/network/heap/layer captures, compact summaries, raw payload lookup, and paint/compositing overlays

Quick profiling flow:

```text
coherentgt_profile_capabilities({})
coherentgt_capture_all_start({ "pageId": 31, "reload": true })
coherentgt_capture_all_stop({ "pageId": 31 })
coherentgt_profile_raw({ "pageId": 31, "rawId": "<rawId from summary>" })
```

Use focused tools such as `coherentgt_timeline_start`, `coherentgt_network_capture_start`, `coherentgt_heap_snapshot`, and `coherentgt_set_paint_rects_visible` when you only need one diagnostic surface.

Agent note: this is a Coherent GT legacy WebKit Inspector target, not modern Chrome DevTools. Agents should use `coherentgt_profile_capabilities` and the profiling tools above instead of probing Chrome-only domains such as `Performance`, `Profiler`, `Tracing`, `HeapProfiler`, `DOMSnapshot`, or `Runtime.getHeapUsage`. If an agent only sees structural/runtime tools and no `coherentgt_capture_all_start`, restart that agent session so it reloads the MCP tool list.

Generic triage flow:

```text
1. coherentgt_list_pages with title/url filters that identify the target Coherent page.
2. coherentgt_diagnose_page with caller-provided selectors and suspect JS/CSS/image URLs.
3. coherentgt_inspect_selector for a caller-provided selector.
4. coherentgt_probe_resource for loaded JS/CSS and suspect coui:// resources.
5. coherentgt_probe_image for image decode verification.
6. Use mutating tools such as coherentgt_reload_view, coherentgt_navigate_view, coherentgt_click, or coherentgt_trigger_event only when the caller supplies selectors, URLs, or engine events.
```

When `Runtime.evaluate` times out, normalized tools return structured timeout metadata with `likelyCause: "main-thread-busy"` where possible. Prefer native DOM/CSS/resource tools before retrying runtime evaluation.

If you need to attach the standalone Coherent Debugger while the MCP client is still running, call `coherentgt_release_page` for the page or `coherentgt_release_all` for every retained page socket. Resource and image probes close their internal diagnostic network lookup socket automatically after the probe completes.

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, navigate, profile, and toggle diagnostic overlays in live views. Use only on local development targets you control.
