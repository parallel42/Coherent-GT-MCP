# CoherentGT MCP

## Project Summary

CoherentGT MCP is a Dockerized TypeScript MCP server for inspecting, debugging, and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

The project exposes stdio and Streamable HTTP MCP transports that can discover Coherent views, send WebKit Inspector commands, inspect DOM/CSS/resources, evaluate runtime JavaScript, interact with the Coherent `engine` bridge, run persistent debugger sessions with breakpoints and call-frame inspection, and capture legacy WebKit profiling telemetry.

Canonical names:

- Repository: `Coherent-GT-MCP`
- Package/server: `coherent-gt-mcp`
- Docker image: `ghcr.io/parallel42/coherent-gt-mcp:latest`
- Container examples: unnamed MCP stdio containers or one named shared HTTP container.

References:

- Coherent GT Debugging: https://coherent-labs.com/Documentation/cpp-gt/dd/d68/debugging.html
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP SDK index: https://modelcontextprotocol.io/docs/sdk

## Runtime Model

The server supports two MCP transport modes:

- `stdio`: one server process per MCP client, communicating over standard input/output.
- `http`: one shared Streamable HTTP server, typically exposed on `http://127.0.0.1:3333/mcp`, that can be reused by multiple MCP clients and agent sessions.

Stdio topology:

```text
MCP client/agent
  -> docker run --rm -i ghcr.io/parallel42/coherent-gt-mcp:latest
    -> http://host.docker.internal:19999/pagelist.json
    -> ws://host.docker.internal:19999/devtools/page/<pageId>
      -> live Coherent GT/MSFS view
```

Shared HTTP topology:

```text
MCP client/agent A -> http://127.0.0.1:3333/mcp
MCP client/agent B -> http://127.0.0.1:3333/mcp
  -> docker run -d --name coherent-gt-mcp-shared -p 3333:3333 ...
    -> http://host.docker.internal:19999/pagelist.json
    -> ws://host.docker.internal:19999/devtools/page/<pageId>
      -> live Coherent GT/MSFS view
```

The host debugger endpoint is normally reachable at `http://127.0.0.1:19999` from Windows. Inside Docker, the same host service must be reached as `http://host.docker.internal:19999`.

## User Requirements

Normal users need:

- Windows with Docker Desktop running Linux containers.
- A stdio-capable MCP client or a Streamable HTTP-capable MCP client or agent.
- MSFS running with the Coherent debugger endpoint available on the host.

Docker Desktop installation:

```powershell
winget install --id Docker.DockerDesktop -e
```

After installing Docker Desktop, restart PowerShell, start Docker Desktop, and verify Docker:

```powershell
docker version
```

Verify the Coherent debugger endpoint while MSFS is running:

```powershell
Invoke-RestMethod http://127.0.0.1:19999/pagelist.json
```

Install the published image:

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

Run command used by stdio MCP clients:

```powershell
docker run --rm -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  ghcr.io/parallel42/coherent-gt-mcp:latest
```

MCP stdio client configurations should not set Docker `--name`. Stdio clients launch the server as a subprocess and may start it repeatedly across app restarts, CLI sessions, and retries. A fixed container name can leave future launches blocked by Docker's name uniqueness check if a previous process is still running or did not exit cleanly.

## MCP Client Configuration

### Shared HTTP Server

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

All Codex sessions using that URL connect to the same container. Persistent debugger/profiling sessions, tracked scripts, retained profiling payloads, and MCP-created breakpoints are shared through the long-running process.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:3333/health
```

Stop the shared server:

```powershell
docker stop coherent-gt-mcp-shared
```

If the shared server exits after being idle, start the same named container again:

```powershell
docker start coherent-gt-mcp-shared
```

### Stdio Per Client

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

Restart the MCP client after changing configuration or pulling a newer image.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `COHERENT_GT_TRANSPORT` | `stdio` | MCP transport mode: `stdio` or `http`. |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` | Base URL for the Coherent debugger service from inside Docker. |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` | Timeout for debugger HTTP requests such as `/pagelist.json`. |
| `COHERENT_GT_WS_TIMEOUT_MS` | `30000` | Timeout for WebKit Inspector WebSocket commands. |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` | Maximum JSON text payload size returned through MCP before truncation metadata is emitted. |
| `COHERENT_GT_IDLE_TIMEOUT_MS` | `3000000` | Idle shutdown timer for stdio and shared HTTP modes. Set to `0` to disable automatic shutdown. |
| `COHERENT_GT_HTTP_HOST` | `0.0.0.0` | HTTP bind host when `COHERENT_GT_TRANSPORT=http`. |
| `COHERENT_GT_HTTP_PORT` | `3333` | HTTP bind port when `COHERENT_GT_TRANSPORT=http`. |
| `COHERENT_GT_HTTP_PATH` | `/mcp` | Streamable HTTP MCP endpoint path. |

Configuration is normalized at startup. Paths, query strings, fragments, and trailing slashes are stripped from `COHERENT_GT_DEBUGGER_URL` before requests are made.

## Capability Matrix

The server is intentionally broad: it supports quick health checks, detailed inspection, live control, resource analysis, and persistent JavaScript debugging.

| Area | Tools | Capability |
| --- | --- | --- |
| Connectivity | `coherentgt_health`, `coherentgt_list_views` | Check debugger reachability and enumerate live views from `/pagelist.json`. |
| Raw inspector access | `coherentgt_inspector_command` | Send any supported WebKit Inspector command to a view as an escape hatch. |
| Runtime JavaScript | `coherentgt_eval_js` | Evaluate expressions with optional promise awaiting and by-value return behavior. |
| Coherent engine bridge | `coherentgt_trigger_event`, `coherentgt_call_engine` | Trigger `engine.trigger(...)` events or call `engine.call(...)` functions with JSON-safe arguments. |
| DOM inspection | `coherentgt_get_document`, `coherentgt_query_selector`, `coherentgt_get_native_document`, `coherentgt_get_outer_html` | Read serialized DOM, query selectors, native DOM trees, and native outer HTML. |
| CSS inspection and mutation | `coherentgt_get_stylesheets`, `coherentgt_get_stylesheet_text`, `coherentgt_get_matched_styles`, `coherentgt_set_style` | List stylesheets, read CSS text, inspect matched rules, and apply inline styles. |
| Resource inspection | `coherentgt_get_resource_tree`, `coherentgt_get_resource_content`, `coherentgt_search_resource` | Read the frame/resource tree, fetch loaded resource text, and search resource content. |
| UI interaction and navigation | `coherentgt_click`, `coherentgt_reload_view`, `coherentgt_navigate_view` | Dispatch click events, reload views, and navigate views. |
| Persistent debugging | `coherentgt_debug_start`, `coherentgt_debug_stop`, `coherentgt_debug_status`, `coherentgt_debug_events`, `coherentgt_debug_command` | Open long-lived inspector sessions, buffer debugger events, and send session-scoped commands. |
| Script analysis | `coherentgt_debug_list_scripts`, `coherentgt_debug_get_script_source`, `coherentgt_debug_search_script`, `coherentgt_debug_search_all_scripts` | Track parsed scripts, retrieve script source, and search one or many scripts. |
| Breakpoints | `coherentgt_debug_set_breakpoint_by_url`, `coherentgt_debug_set_breakpoint`, `coherentgt_debug_remove_breakpoint`, `coherentgt_debug_list_breakpoints`, `coherentgt_debug_set_event_listener_breakpoint`, `coherentgt_debug_set_xhr_breakpoint`, `coherentgt_debug_set_dom_breakpoint` | Manage URL, script-location, event-listener, XHR/fetch, and DOM breakpoints. |
| Pause and stepping | `coherentgt_debug_pause`, `coherentgt_debug_resume`, `coherentgt_debug_step_over`, `coherentgt_debug_step_into`, `coherentgt_debug_step_out`, `coherentgt_debug_paused`, `coherentgt_debug_evaluate_on_call_frame` | Pause/resume JavaScript, step through paused code, inspect paused state, and evaluate in call frames. |
| Profiling and telemetry | `coherentgt_profile_start`, `coherentgt_profile_stop`, `coherentgt_profile_status`, `coherentgt_profile_events`, `coherentgt_profile_raw`, `coherentgt_capture_all_start`, `coherentgt_capture_all_stop` | Capture legacy Timeline, ScriptProfiler, Network, Heap, and LayerTree events with compact summaries and raw payload lookup. |
| Focused profiling | `coherentgt_script_profile_start`, `coherentgt_script_profile_stop`, `coherentgt_timeline_start`, `coherentgt_timeline_stop`, `coherentgt_network_capture_start`, `coherentgt_network_capture_stop`, `coherentgt_heap_snapshot`, `coherentgt_heap_start_tracking`, `coherentgt_heap_stop_tracking`, `coherentgt_heap_gc` | Run targeted captures for CPU/script samples, frame/layout/paint timelines, network waterfalls, and heap snapshots/tracking. |
| Visual diagnostics | `coherentgt_layer_tree`, `coherentgt_compositing_reasons`, `coherentgt_set_paint_rects_visible`, `coherentgt_set_compositing_borders_visible` | Inspect layer/compositing data and toggle paint/compositing overlays. |

## Tool Reference

### Connectivity

- `coherentgt_health`
  - Input: `{}`
  - Checks debugger root and `/pagelist.json`.
  - Output includes target URL, reachable state, page count, and error details when unavailable.

- `coherentgt_list_views`
  - Input: `{ refresh?: boolean }`
  - Reads `/pagelist.json`.
  - Output entries include `{ id, title, url, inspectorUrl, websocketUrl }`.

### Inspector and Runtime

- `coherentgt_inspector_command`
  - Input: `{ pageId: number, method: string, params?: object, timeoutMs?: number }`
  - Sends a raw WebKit Inspector command to `ws://<host>/devtools/page/<pageId>`.
  - Output includes the raw protocol response and any events observed before the matching response.

- `coherentgt_eval_js`
  - Input: `{ pageId: number, expression: string, awaitPromise?: boolean, returnByValue?: boolean, timeoutMs?: number }`
  - Uses `Runtime.evaluate`.
  - Defaults: `awaitPromise: false`, `returnByValue: true`.

- `coherentgt_trigger_event`
  - Input: `{ pageId: number, eventName: string, args?: unknown[] }`
  - Evaluates `engine.trigger(eventName, ...args)` in the target view.
  - Mutating: communicates with the live game-side UI bridge when `engine` is present.

- `coherentgt_call_engine`
  - Input: `{ pageId: number, functionName: string, args?: unknown[], awaitPromise?: boolean }`
  - Evaluates `engine.call(functionName, ...args)`.
  - Defaults: `awaitPromise: true`.
  - Mutating: can invoke live UI/game bridge behavior.

### DOM, CSS, and Resources

- `coherentgt_get_document`
  - Input: `{ pageId: number, selector?: string, includeText?: boolean, maxDepth?: number }`
  - Serializes a DOM subtree with JavaScript.
  - Defaults: `selector: "document.documentElement"`, `includeText: true`, `maxDepth: 8`.

- `coherentgt_query_selector`
  - Input: `{ pageId: number, selector: string, includeComputedStyle?: boolean }`
  - Returns matched node summary, text, attributes, rect, and optional computed style.

- `coherentgt_get_native_document`
  - Input: `{ pageId: number, depth?: number, pierce?: boolean }`
  - Uses native WebInspector `DOM.getDocument`.

- `coherentgt_get_outer_html`
  - Input: `{ pageId: number, selector?: string, nodeId?: number }`
  - Uses native WebInspector `DOM.getOuterHTML`.
  - Accepts either a known `nodeId` or a selector that is resolved through `DOM.querySelector`.

- `coherentgt_get_stylesheets`
  - Input: `{ pageId: number }`
  - Uses native WebInspector `CSS.getAllStyleSheets`.

- `coherentgt_get_stylesheet_text`
  - Input: `{ pageId: number, styleSheetId: string }`
  - Enables CSS and reads stylesheet text with `CSS.getStyleSheetText`.

- `coherentgt_get_matched_styles`
  - Input: `{ pageId: number, selector: string }`
  - Resolves the selector to a native node id and reads matched CSS rules with `CSS.getMatchedStylesForNode`.

- `coherentgt_set_style`
  - Input: `{ pageId: number, selector: string, styles: Record<string, string> }`
  - Applies inline styles to all matched nodes.
  - Mutating.

- `coherentgt_get_resource_tree`
  - Input: `{ pageId: number }`
  - Uses native WebInspector `Page.getResourceTree`.

- `coherentgt_get_resource_content`
  - Input: `{ pageId: number, url: string, frameId?: string }`
  - Uses native WebInspector `Page.getResourceContent`.
  - If `frameId` is omitted, the main frame id is resolved from `Page.getResourceTree`.

- `coherentgt_search_resource`
  - Input: `{ pageId: number, url: string, query: string, frameId?: string, caseSensitive?: boolean, isRegex?: boolean }`
  - Uses native WebInspector `Page.searchInResource`.
  - Defaults: `caseSensitive: false`, `isRegex: false`.

### Interaction and Navigation

- `coherentgt_click`
  - Input: `{ pageId: number, selector: string }`
  - Dispatches mouse events on the first matched element.
  - Mutating.

- `coherentgt_reload_view`
  - Input: `{ pageId: number, ignoreCache?: boolean }`
  - Uses `Page.reload` when available and falls back to `location.reload()`.
  - Mutating.

- `coherentgt_navigate_view`
  - Input: `{ pageId: number, url: string }`
  - Uses `Page.navigate`.
  - High-risk mutating tool because it navigates a live view.

### Profiling and Telemetry

Profiling keeps a WebInspector socket open per `pageId`, buffers legacy WebKit Inspector telemetry events, and stores large heap/script payloads behind `rawId` values.

- `coherentgt_profile_start`
  - Input: `{ pageId: number, instruments?: ("timeline"|"script"|"network"|"heap"|"layerTree")[], reload?: boolean, ignoreCache?: boolean, maxCallStackDepth?: number, timelineInstruments?: ("Timeline"|"ScriptProfiler"|"Memory"|"Heap")[] }`
  - Starts a persistent capture. Defaults to timeline, script, and network.
  - If `reload` is true, calls `Page.reload` after capture setup.

- `coherentgt_profile_stop`
  - Input: `{ pageId: number, instruments?: ("timeline"|"script"|"network"|"heap"|"layerTree")[] }`
  - Stops selected instruments, or all active instruments when omitted.
  - Output includes compact network waterfall, timeline, script, heap, and layer summaries.

- `coherentgt_capture_all_start` / `coherentgt_capture_all_stop`
  - Convenience flow for timeline, script, network, heap, and layer tree capture.

- `coherentgt_profile_status`, `coherentgt_profile_events`, `coherentgt_profile_raw`
  - Inspect profiling sessions, buffered event metadata, and retained raw payloads by `rawId`.

- `coherentgt_script_profile_start`, `coherentgt_script_profile_stop`
  - Focused legacy `ScriptProfiler.startTracking` / `stopTracking`.

- `coherentgt_timeline_start`, `coherentgt_timeline_stop`
  - Focused legacy `Timeline.setInstruments`, `Timeline.start`, and `Timeline.stop`.

- `coherentgt_network_capture_start`, `coherentgt_network_capture_stop`
  - Focused `Network.enable` capture with request waterfall summaries.

- `coherentgt_heap_snapshot`, `coherentgt_heap_start_tracking`, `coherentgt_heap_stop_tracking`, `coherentgt_heap_gc`
  - Legacy heap snapshot/tracking/GC tools. Snapshot responses return metadata and a `rawId`; raw snapshot data is read with `coherentgt_profile_raw`.

- `coherentgt_layer_tree`, `coherentgt_compositing_reasons`, `coherentgt_set_paint_rects_visible`, `coherentgt_set_compositing_borders_visible`
  - Layer/compositing inspection and visual diagnostics based on `LayerTree` and `Page` overlay commands.

### Persistent Debugging

Persistent debugging keeps a WebInspector socket open per `pageId`. It enables `Runtime`, `Page`, and `Debugger`, tracks `Debugger.scriptParsed` events, buffers recent events, stores MCP-created breakpoints, and remembers the current paused state.

- `coherentgt_debug_start`
  - Input: `{ pageId: number, pauseOnExceptions?: "none" | "all" | "uncaught" }`
  - Opens or reuses a persistent debugger session.
  - Defaults: `pauseOnExceptions: "none"`.

- `coherentgt_debug_stop`
  - Input: `{ pageId: number }`
  - Closes a persistent debugger session for the view.

- `coherentgt_debug_status`
  - Input: `{ pageId?: number }`
  - Returns one session status or all active session statuses.

- `coherentgt_debug_events`
  - Input: `{ pageId: number, sinceSequence?: number, maxEvents?: number, eventTypes?: string[] }`
  - Reads buffered debugger events.
  - Defaults: `maxEvents: 50`; maximum accepted value is `500`.

- `coherentgt_debug_command`
  - Input: `{ pageId: number, method: string, params?: object }`
  - Sends a raw WebInspector command over an active persistent session.

- `coherentgt_debug_paused`
  - Input: `{ pageId: number }`
  - Returns the current `Debugger.paused` payload, including call frames and scopes, or `null`.

- `coherentgt_debug_list_scripts`
  - Input: `{ pageId: number, urlContains?: string }`
  - Lists scripts observed through `Debugger.scriptParsed`.

- `coherentgt_debug_get_script_source`
  - Input: `{ pageId: number, scriptId: string }`
  - Reads script source with `Debugger.getScriptSource`.

- `coherentgt_debug_search_script`
  - Input: `{ pageId: number, scriptId: string, query: string, caseSensitive?: boolean, isRegex?: boolean }`
  - Searches one script with `Debugger.searchInContent`.

- `coherentgt_debug_search_all_scripts`
  - Input: `{ pageId: number, query: string, urlContains?: string, caseSensitive?: boolean, isRegex?: boolean, maxScripts?: number }`
  - Searches observed scripts, optionally filtered by URL.
  - Defaults: `caseSensitive: false`, `isRegex: false`, `maxScripts: 100`; maximum accepted `maxScripts` is `500`.

- `coherentgt_debug_set_breakpoint_by_url`
  - Input: `{ pageId: number, url: string, lineNumber: number, columnNumber?: number, condition?: string }`
  - Sets a URL breakpoint with `Debugger.setBreakpointByUrl`.
  - Mutating: pauses live UI JavaScript when hit.

- `coherentgt_debug_set_breakpoint`
  - Input: `{ pageId: number, scriptId: string, lineNumber: number, columnNumber?: number, condition?: string }`
  - Sets a script-location breakpoint with `Debugger.setBreakpoint`.
  - Mutating.

- `coherentgt_debug_remove_breakpoint`
  - Input: `{ pageId: number, breakpointId: string }`
  - Removes JavaScript, event-listener, XHR, or DOM breakpoints created through the MCP debug session.

- `coherentgt_debug_list_breakpoints`
  - Input: `{ pageId: number }`
  - Lists breakpoints registered through the MCP debug session.

- `coherentgt_debug_pause`
  - Input: `{ pageId: number }`
  - Sends `Debugger.pause`.
  - Mutating.

- `coherentgt_debug_resume`
  - Input: `{ pageId: number }`
  - Sends `Debugger.resume`.
  - Mutating.

- `coherentgt_debug_step_over`
  - Input: `{ pageId: number }`
  - Sends `Debugger.stepOver`.
  - Mutating.

- `coherentgt_debug_step_into`
  - Input: `{ pageId: number }`
  - Sends `Debugger.stepInto`.
  - Mutating.

- `coherentgt_debug_step_out`
  - Input: `{ pageId: number }`
  - Sends `Debugger.stepOut`.
  - Mutating.

- `coherentgt_debug_evaluate_on_call_frame`
  - Input: `{ pageId: number, callFrameId?: string, expression: string, returnByValue?: boolean }`
  - Evaluates JavaScript in a paused call frame.
  - If `callFrameId` is omitted, the top paused call frame is used.

- `coherentgt_debug_set_event_listener_breakpoint`
  - Input: `{ pageId: number, eventName: string }`
  - Sets a `DOMDebugger.setEventListenerBreakpoint`.
  - Mutating.

- `coherentgt_debug_set_xhr_breakpoint`
  - Input: `{ pageId: number, url?: string }`
  - Sets a `DOMDebugger.setXHRBreakpoint`.
  - Empty URL pauses on all XHR/fetch activity.
  - Mutating.

- `coherentgt_debug_set_dom_breakpoint`
  - Input: `{ pageId: number, selector: string, type: "subtree-modified" | "attribute-modified" | "node-removed" }`
  - Resolves a selector to a native DOM node and sets `DOMDebugger.setDOMBreakpoint`.
  - Mutating.

## Implementation Details

The implementation uses:

- `@modelcontextprotocol/sdk@1.29.0`
- `zod` for strict tool schemas
- `ws` for WebSocket transport
- TypeScript ESM on Node 20+
- `tsx`, `typescript`, and `vitest` for local development

Important implementation behavior:

- `src/index.ts` starts the MCP server over `StdioServerTransport` and writes diagnostics to stderr.
- `src/config.ts` loads and validates environment configuration.
- `src/coherent/debugger-client.ts` reads `/pagelist.json`, normalizes entries, and builds Docker-safe WebSocket URLs from the configured debugger host.
- `src/coherent/inspector-client.ts` supports one-command inspector calls and short multi-command sessions.
- `src/coherent/persistent-inspector.ts` maintains long-lived debugger sessions, tracks scripts, buffers events, stores breakpoints, and records paused state.
- `src/tools/result.ts` caps oversized JSON responses while keeping the MCP payload parseable.
- Runtime-generated JavaScript uses `JSON.stringify` for selectors, style maps, event names, function names, and arguments.
- Generated snippets avoid modern JavaScript APIs that older Coherent WebKit builds may not support.

## Repository Shape

```text
Coherent-GT-MCP/
  .dockerignore
  .github/
    workflows/
      docker-image.yml
  .gitignore
  Dockerfile
  README.md
  Coherent-GT-MCP.md
  package.json
  package-lock.json
  tsconfig.json
  src/
    index.ts
    config.ts
    mcp-server.ts
    coherent/
      debugger-client.ts
      inspector-client.ts
      persistent-inspector.ts
      protocol.ts
      view-selector.ts
    tools/
      css.ts
      debugger.ts
      dom.ts
      events.ts
      health.ts
      inspector.ts
      native-inspector.ts
      navigation.ts
      result.ts
      runtime.ts
      schemas.ts
      views.ts
  tests/
    fixtures/
      pagelist.json
    unit/
      debugger-client.test.ts
      runtime.test.ts
      tool-schemas.test.ts
      view-selector.test.ts
```

## Docker Image

The Dockerfile is multi-stage:

- `deps`: installs dependencies with `npm ci`.
- `build`: compiles TypeScript into `dist`.
- `runtime`: installs production dependencies only and runs `node dist/index.js`.

Default runtime image environment:

```text
NODE_ENV=production
COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999
```

No Docker port publication is required.

## Publishing

`.github/workflows/docker-image.yml` publishes to GitHub Container Registry:

- `latest` on the default branch.
- Git tag images for `v*` tags.
- SHA tags for traceability.
- Manual `workflow_dispatch` support.

Published image target:

```text
ghcr.io/parallel42/coherent-gt-mcp
```

## Testing

Automated checks:

```powershell
npm run build
npm run typecheck
npm test
```

Current unit coverage includes:

- Coherent debugger URL normalization and WebSocket URL construction.
- Fixture parsing from `/pagelist.json`.
- Strict tool schema acceptance and rejection.
- Resource, DOM, navigation, style, and debugger input schemas.
- Runtime snippet argument escaping through `JSON.stringify`.
- Compatibility checks that generated snippets avoid unsupported modern JavaScript syntax.
- Oversized MCP JSON response truncation behavior.
- Config defaults for transport, WebSocket timeout, idle shutdown, and HTTP binding.

Manual acceptance checks:

1. Start MSFS.
2. Confirm the host can open `http://127.0.0.1:19999/pagelist.json`.
3. Pull `ghcr.io/parallel42/coherent-gt-mcp:latest`.
4. Run an MCP Inspector or local MCP client against either the Docker stdio command or the shared HTTP endpoint.
5. Call `coherentgt_health`; expect `reachable: true` and a nonzero page count.
6. Call `coherentgt_list_views`; expect entries such as `MAIN UI`, `Toolbar`, `ATLAS`, or aircraft/EFB panels depending on the session.
7. Call `coherentgt_eval_js` with `document.title`.
8. Call `coherentgt_query_selector` with `body`.
9. Call `coherentgt_get_resource_tree` and inspect loaded `coui://` resources.
10. Start a debugger session with `coherentgt_debug_start`, then list scripts with `coherentgt_debug_list_scripts`.
11. Use mutating tools only on safe targets, for example applying and then clearing a reversible outline style on `body`.

## Security and Safety

This project is a local development and debugging tool. Several tools can modify live views or execute code:

- `coherentgt_eval_js` can run arbitrary JavaScript.
- `coherentgt_trigger_event` and `coherentgt_call_engine` can communicate with the Coherent engine bridge.
- `coherentgt_click`, `coherentgt_set_style`, `coherentgt_reload_view`, and `coherentgt_navigate_view` mutate the active UI.
- Profiling captures can reload views when `reload: true`, request heap GC, and toggle visual diagnostics.
- Debug breakpoints, pause, resume, and stepping affect live JavaScript execution.

Use the server only with local development targets you control. Treat MCP client access to this server as equivalent to debugger access to the running Coherent UI.

## Troubleshooting

- If `coherentgt_health` is unreachable, verify MSFS is running and the host endpoint works:

  ```powershell
  Invoke-RestMethod http://127.0.0.1:19999/pagelist.json
  ```

- If the endpoint works on the host but fails in Docker, verify the MCP config uses `http://host.docker.internal:19999`, not `http://127.0.0.1:19999`.
- If views are missing, open or reload the relevant MSFS panel and call `coherentgt_list_views` again.
- If native CSS/DOM/resource tools fail, retry with `coherentgt_inspector_command` to check whether that WebInspector domain is supported by the target Coherent build.
- If persistent debugger tools report no active session, call `coherentgt_debug_start` for that `pageId` first.
- If a stdio or shared HTTP container exits after being idle, increase `COHERENT_GT_IDLE_TIMEOUT_MS` or set it to `0`.
- If HTTP clients cannot connect, verify the shared container is running and `Invoke-RestMethod http://127.0.0.1:3333/health` succeeds.

## Current Boundaries

- The server supports Dockerized stdio MCP and Dockerized Streamable HTTP MCP.
- It does not ship a native C++ bridge.
- The HTTP transport exposes local MCP and health endpoints only.
- It is intended for local development/debugging, not embedded use in shipped products.
- Coherent capability can vary by simulator state, loaded panel, and the WebInspector domains supported by the active Coherent build.
