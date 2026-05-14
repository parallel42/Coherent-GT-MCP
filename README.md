# p42-coherentgt-mcp

Dockerized TypeScript MCP server for inspecting and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

The server uses the documented/observable debugger HTTP and WebKit Inspector endpoints. It does not decompile Coherent binaries.

## Requirements

- Node.js 20+ for local development.
- Docker Desktop for containerized MCP usage.
- Coherent GT debugger/developer module enabled and reachable.
- Host endpoint available at `http://127.0.0.1:19999/pagelist.json`.

In Docker, the default debugger URL is `http://host.docker.internal:19999`.

## Build

```powershell
npm install
npm run build
docker build -t p42-coherentgt-mcp .
```

## Run

This server uses MCP stdio transport, so no Docker port exposure is required.

```powershell
docker run --rm -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  p42-coherentgt-mcp
```

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

## MCP Client Config

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
