# CoherentGT MCP

MCP server for inspecting and controlling live Coherent GT UI views through the Coherent debugger service.

- Host debugger: `http://127.0.0.1:19999/pagelist.json`
- Transports: MCP stdio, or shared Streamable HTTP on `/mcp`
- Scope: debugger HTTP + WebKit Inspector endpoints

## Quick Start

### 1. Start A Coherent GT Host

Verify the Coherent debugger endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:19999/pagelist.json
```

### 2. Install And Build

```powershell
npm ci
npm run build
```

### 3. Add The MCP Server To Codex

```toml
[mcp_servers.p42-coherentgt-mcp]
command = "node"
args = ['C:\path\to\coherent-gt-mcp\scripts\codex-shared-mcp-proxy.mjs']

[mcp_servers.p42-coherentgt-mcp.env]
COHERENT_GT_TRANSPORT = "stdio"
COHERENT_GT_IDLE_TIMEOUT_MS = "0"
COHERENT_GT_DEBUGGER_URL = "http://127.0.0.1:19999"
```

Restart Codex after changing the MCP configuration, then call `coherentgt_health` and `coherentgt_list_views`.

The Codex launcher keeps the stdio transport open and supervises the built MCP child process. If the child exits,
the current request returns an MCP error and the next request starts a fresh child after replaying initialization.

### Optional Shared HTTP Mode

Run one local Node HTTP server:

```powershell
$env:COHERENT_GT_TRANSPORT = "http"
$env:COHERENT_GT_DEBUGGER_URL = "http://127.0.0.1:19999"
node .\dist\index.js
```

Codex can then connect to the shared endpoint:

```toml
[mcp_servers.coherent-gt-mcp]
url = "http://127.0.0.1:3333/mcp"
```

All active Codex sessions that use this URL connect to the same Node process and share persistent debugger session state. When the last MCP HTTP session disconnects, the server closes retained Coherent WebInspector sockets so the standalone Coherent Debugger can attach. Check the shared server with:

```powershell
Invoke-RestMethod http://127.0.0.1:3333/health
```

### JSON Clients

```json
{
  "mcpServers": {
    "coherent-gt-mcp": {
      "command": "node",
      "args": [
        "C:\\path\\to\\coherent-gt-mcp\\dist\\index.js"
      ],
      "env": {
        "COHERENT_GT_TRANSPORT": "stdio",
        "COHERENT_GT_IDLE_TIMEOUT_MS": "0",
        "COHERENT_GT_DEBUGGER_URL": "http://127.0.0.1:19999"
      }
    }
  }
}
```

## Update

```powershell
git pull
npm ci
npm run build
```

Restart the agent after rebuilding. MCP clients usually cache tool metadata for the lifetime of a session, so a session that started before a rebuild can still report the older tool set.

## Configuration

| Variable | Default |
| --- | --- |
| `COHERENT_GT_TRANSPORT` | `stdio` |
| `COHERENT_GT_DEBUGGER_URL` | `http://127.0.0.1:19999` |
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

`COHERENT_GT_DEBUGGER_URL` defaults to the local Coherent debugger endpoint. Set it to another host URL only when the debugger service is exposed somewhere other than `127.0.0.1`. `COHERENT_GT_IDLE_TIMEOUT_MS` applies to stdio and shared HTTP modes and defaults to 50 minutes; set it to `0` to disable automatic shutdown. Codex stdio configs should pin it to `0`, because Codex can keep cached tool metadata after an MCP subprocess exits.

Oversized tool replies are cached in memory and returned as a small preview with a `resultId`. Use `coherentgt_result_read` to read bounded byte ranges from the cached reply, or `coherentgt_result_search` to find compact match snippets without loading the full payload into the agent context. `COHERENT_GT_INLINE_RESULT_BYTES` controls when this kicks in, `COHERENT_GT_RESULT_PREVIEW_BYTES` controls the initial preview size, and `COHERENT_GT_RESULT_CHUNK_BYTES` controls the default follow-up read size.

Optional host process/log/resource correlation is available through a read-only Windows helper:

```powershell
$env:COHERENT_GT_HOST_HELPER_LOG_ROOTS = "C:\Path\To\Logs|D:\OtherLogs"
$env:COHERENT_GT_HOST_HELPER_RESOURCE_ROOTS = "C:\Path\To\Resources|D:\OtherResources"
npm run host-helper
```

Point the MCP server at it with `COHERENT_GT_HOST_HELPER_URL=http://127.0.0.1:3344`. Process names, log roots, and local resource roots are allowlists; when the helper is not configured, diagnostic tools return an explicit unavailable reason.

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Generic diagnostics: `coherentgt_list_pages`, `coherentgt_evaluate`, `coherentgt_engine_diagnostics`, `coherentgt_console_snapshot`, `coherentgt_runtime_errors`, `coherentgt_page_health`, `coherentgt_network_snapshot`, `coherentgt_event_listeners`, `coherentgt_trace_events`, `coherentgt_diagnose_page`
- Cached large replies: `coherentgt_result_read`, `coherentgt_result_search`
- Session cleanup: `coherentgt_release_page`, `coherentgt_release_all`
- Runtime/control: JavaScript eval, engine calls/events, synthetic clicks, trusted coordinate clicks when supported, verified activation, reloads, and navigation
- DOM/CSS/resources: document, selector, style, stylesheet, resource, native inspector helpers, `coherentgt_inspect_selector`, `coherentgt_probe_resource`, and `coherentgt_probe_image`
- Debugger: persistent debug sessions, script search, breakpoints, pause/resume, stepping, and call-frame evaluation. These are target-dependent and can be fragile in Coherent; prefer lightweight DOM/runtime/resource probes unless a breakpoint session is explicitly needed.
- Profiling: capabilities guidance, legacy timeline/script/network/heap/layer captures, compact summaries, raw payload lookup, and paint/compositing overlays

Quick profiling flow:

```text
coherentgt_profile_capabilities({})
coherentgt_capture_all_start({ "pageId": 31, "reload": true })
coherentgt_capture_all_stop({ "pageId": 31 })
coherentgt_profile_raw({ "pageId": 31, "rawId": "<rawId from summary>" })
```

Use focused tools such as `coherentgt_timeline_start`, `coherentgt_network_capture_start`, `coherentgt_heap_snapshot`, and `coherentgt_set_paint_rects_visible` when you only need one diagnostic surface.

Agent note: this is a Coherent GT legacy WebKit Inspector target, not modern Chrome DevTools. Agents should use `coherentgt_profile_capabilities` and the profiling tools above instead of probing Chrome-only domains such as `Performance`, `Profiler`, `Tracing`, `HeapProfiler`, `DOMSnapshot`, or `Runtime.getHeapUsage`. Prefer one-shot DOM/runtime/resource/image tools before persistent `Debugger.enable` sessions; some Coherent instances reset the WebInspector socket during long-lived debugger attachment. If an agent only sees structural/runtime tools and no `coherentgt_capture_all_start`, restart that agent session so it reloads the MCP tool list.

Generic triage flow:

```text
1. coherentgt_list_pages with title/url filters that identify the target Coherent page.
2. coherentgt_diagnose_page with caller-provided selectors and suspect JS/CSS/image URLs.
3. coherentgt_inspect_selector for a caller-provided selector.
4. coherentgt_probe_resource for loaded JS/CSS and suspect coui:// resources.
5. coherentgt_probe_image for image decode verification.
6. Use mutating tools such as coherentgt_activate, coherentgt_click_at, coherentgt_reload_view, coherentgt_navigate_view, coherentgt_click, or coherentgt_trigger_event only when the caller supplies selectors, coordinates, URLs, or engine events.
```

When `Runtime.evaluate` times out, normalized tools return structured timeout metadata with `likelyCause: "main-thread-busy"` where possible. Prefer native DOM/CSS/resource tools before retrying runtime evaluation.

`coherentgt_click` dispatches synthetic DOM events and can report dispatch success even when native Coherent/MSFS bindings ignore the action. Prefer `coherentgt_activate` with a caller-supplied postcondition for workflow steps, and use `coherentgt_click_at`/`trusted-click` only when the target supports WebInspector `Input.dispatchMouseEvent`.

If you need to attach the standalone Coherent Debugger while the MCP client is still running, call `coherentgt_release_page` for the page or `coherentgt_release_all` for every retained page socket. Resource and image probes close their internal diagnostic network lookup socket automatically after the probe completes.

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, navigate, profile, and toggle diagnostic overlays in live views. Use only on local development targets you control.
