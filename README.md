# p42-coherentgt-mcp

`p42-coherentgt-mcp` is a Dockerized Model Context Protocol server for inspecting, debugging, and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

It gives MCP-capable agents tools for listing Coherent views, reading DOM and CSS state, evaluating JavaScript, triggering `engine` calls/events, clicking UI elements, navigating or reloading views, and using WebKit Inspector debugger features such as breakpoints and script inspection.

The server uses the documented and observable debugger HTTP and WebKit Inspector endpoints. It does not decompile Coherent binaries.

## How It Works

- Transport: MCP stdio.
- Runtime: Docker container running Node.js 20.
- Target: a local Coherent GT debugger service, usually `http://127.0.0.1:19999` on the host.
- Docker target URL: `http://host.docker.internal:19999`, because `127.0.0.1` inside the container is the container itself.

No Docker port is exposed. The agent starts the container and communicates with it over standard input/output.

## Requirements

- Node.js 20+ for local development and tests.
- Docker Desktop for containerized MCP usage.
- Coherent GT debugger/developer module enabled and reachable.
- Host endpoint available at `http://127.0.0.1:19999/pagelist.json`.
- Access to the private `parallel42/p42-coherentgt-mcp` GitHub repository.

## Docker Install

```powershell
gh auth login
git clone https://github.com/parallel42/p42-coherentgt-mcp.git
cd p42-coherentgt-mcp
docker build -t p42-coherentgt-mcp .
```

If you already have the repository checked out, only the Docker build is required:

```powershell
docker build -t p42-coherentgt-mcp .
```

## Run Manually

This server uses MCP stdio transport, so no Docker port exposure is required.

```powershell
docker run --rm -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  p42-coherentgt-mcp
```

The command waits for MCP messages on stdin. When launched by an agent, this is expected.

## Reusable Docker Container

Create a named container once:

```powershell
docker create -i `
  --name p42-coherentgt-mcp `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  p42-coherentgt-mcp
```

Launch it manually:

```powershell
docker start -ai p42-coherentgt-mcp
```

If the image is rebuilt, recreate the named container so it uses the latest image.

## Add To Agents As MCP

Use the built Docker image as a local stdio MCP server. Most MCP clients use either JSON `mcpServers` configuration or a TOML variant.

### JSON MCP Config

Use this with clients that support `mcpServers` JSON configuration, such as Claude Desktop, Cursor, and other MCP-compatible agent hosts:

```json
{
  "mcpServers": {
    "p42-coherentgt-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999",
        "p42-coherentgt-mcp"
      ]
    }
  }
}
```

Restart the agent client after updating its MCP configuration.

### Codex Config

Add this to your Codex config, usually `%USERPROFILE%\.codex\config.toml` on Windows:

```toml
[mcp_servers.p42-coherentgt-mcp]
command = "docker"
args = [
  "run",
  "--rm",
  "-i",
  "-e",
  "COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999",
  "p42-coherentgt-mcp"
]
```

Restart Codex after changing the config. The MCP tools should then be available under names beginning with `coherentgt_`.

## Configuration

The container supports these environment variables:

- `COHERENT_GT_DEBUGGER_URL`: base URL for the Coherent debugger service. Defaults to `http://host.docker.internal:19999`.
- `COHERENT_GT_REQUEST_TIMEOUT_MS`: HTTP request timeout in milliseconds. Defaults to `5000`.
- `COHERENT_GT_WS_TIMEOUT_MS`: WebSocket inspector timeout in milliseconds. Defaults to `10000`.
- `COHERENT_GT_MAX_TEXT_BYTES`: maximum text payload size returned by tools. Defaults to `262144`.

## Tools

- `coherentgt_health`: checks debugger root and `/pagelist.json`.
- `coherentgt_list_views`: lists inspectable Coherent views.
- `coherentgt_inspector_command`: sends a raw WebKit Inspector command.
- `coherentgt_eval_js`: evaluates JavaScript in a view.
- `coherentgt_trigger_event`: calls `engine.trigger(...)`.
- `coherentgt_call_engine`: calls `engine.call(...)`.
- `coherentgt_get_document`: serializes a DOM subtree.
- `coherentgt_query_selector`: summarizes matching DOM nodes.
- `coherentgt_set_style`: applies inline styles to matched nodes.
- `coherentgt_click`: dispatches mouse events on the first matched element.
- `coherentgt_reload_view`: reloads a view.
- `coherentgt_navigate_view`: navigates a view to a URL.
- `coherentgt_get_resource_tree`: reads native WebInspector resource tree data.
- `coherentgt_get_resource_content`: reads loaded resource text by URL.
- `coherentgt_search_resource`: searches a loaded resource by URL.
- `coherentgt_get_native_document`: reads native WebInspector DOM tree data.
- `coherentgt_get_outer_html`: reads native outerHTML for a selector or node id.
- `coherentgt_get_stylesheets`: lists native WebInspector stylesheet headers.
- `coherentgt_get_stylesheet_text`: reads CSS text by `styleSheetId`.
- `coherentgt_get_matched_styles`: reads native matched CSS rules for a selector.
- `coherentgt_debug_start`: opens a persistent debugger session for a view.
- `coherentgt_debug_stop`: closes a persistent debugger session.
- `coherentgt_debug_status`: reports active debug sessions.
- `coherentgt_debug_events`: reads buffered WebInspector events.
- `coherentgt_debug_paused`: returns paused call frames and scopes.
- `coherentgt_debug_list_scripts`: lists scripts from `Debugger.scriptParsed`.
- `coherentgt_debug_get_script_source`: reads source by `scriptId`.
- `coherentgt_debug_search_script`: searches one script.
- `coherentgt_debug_search_all_scripts`: searches known scripts.
- `coherentgt_debug_set_breakpoint_by_url`: sets a URL/line breakpoint.
- `coherentgt_debug_set_breakpoint`: sets a scriptId/line breakpoint.
- `coherentgt_debug_remove_breakpoint`: removes JS, DOM, XHR, or event breakpoints.
- `coherentgt_debug_list_breakpoints`: lists breakpoints registered through this server.
- `coherentgt_debug_pause`: pauses JavaScript execution.
- `coherentgt_debug_resume`: resumes JavaScript execution.
- `coherentgt_debug_step_over`: steps over a paused call frame.
- `coherentgt_debug_step_into`: steps into a paused call frame.
- `coherentgt_debug_step_out`: steps out of a paused call frame.
- `coherentgt_debug_evaluate_on_call_frame`: evaluates JavaScript in a paused frame.
- `coherentgt_debug_set_event_listener_breakpoint`: pauses on events such as `click`.
- `coherentgt_debug_set_xhr_breakpoint`: pauses on matching XHR/fetch.
- `coherentgt_debug_set_dom_breakpoint`: pauses when a selected node changes.

## Debugging Workflow

1. Start with `coherentgt_list_views` and choose a `pageId`.
2. Use `coherentgt_query_selector`, `coherentgt_get_outer_html`, and `coherentgt_get_matched_styles` to identify the UI element.
3. Call `coherentgt_debug_start` for that `pageId`.
4. Use `coherentgt_debug_list_scripts` and `coherentgt_debug_search_all_scripts` to find candidate source.
5. Set breakpoints with `coherentgt_debug_set_event_listener_breakpoint`, `coherentgt_debug_set_dom_breakpoint`, or `coherentgt_debug_set_breakpoint_by_url`.
6. Reproduce the UI action, then inspect `coherentgt_debug_paused`, `coherentgt_debug_events`, and `coherentgt_debug_evaluate_on_call_frame`.
7. Step with `coherentgt_debug_step_over`, `coherentgt_debug_step_into`, or `coherentgt_debug_step_out`, then `coherentgt_debug_resume`.

## Security

These tools can evaluate JavaScript, click UI, trigger `engine` events, reload pages, and navigate live Coherent views. Only run this server against local development targets that you control.

## Troubleshooting

- Test the host endpoint directly: `http://127.0.0.1:19999/pagelist.json`.
- From Docker, use `host.docker.internal`, not `127.0.0.1`.
- If no views are listed, confirm MSFS is running and the Coherent debugger service is active.

## Manual Acceptance

1. Start MSFS/Coherent debugger service.
2. Confirm host can open `http://127.0.0.1:19999/pagelist.json`.
3. Build Docker image.
4. Run MCP Inspector or a local MCP client against the Docker stdio command.
5. Call `coherentgt_health`; expect reachable and nonzero page count.
6. Call `coherentgt_list_views`; expect entries such as `ATLAS`, `MAIN UI`, `Electronic Flight Bag`, or `Toolbar`.
7. Call `coherentgt_eval_js` with `document.title`.
8. Call `coherentgt_query_selector` with selector `body`.
9. Call `coherentgt_set_style` on a safe target with a reversible outline style.
10. Call `coherentgt_inspector_command` with a basic Runtime command.

## Reverse Engineering Policy

Use endpoint discovery and inspector protocol behavior first.

Only inspect or decompile binaries if `/pagelist.json` and `/devtools/page/<id>` are insufficient, protocol methods differ from WebKit Inspector expectations, or hidden endpoints are required for screenshots/profiling.

If binary inspection becomes necessary, document findings in `docs/protocol-notes.md` without committing proprietary binaries or extracted copyrighted source.
