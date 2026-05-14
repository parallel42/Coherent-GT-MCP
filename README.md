# p42-coherentgt-mcp

Dockerized stdio MCP server for inspecting and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

- Host debugger: `http://127.0.0.1:19999/pagelist.json`
- Docker debugger URL: `http://host.docker.internal:19999`
- Transport: MCP stdio, no exposed Docker ports
- Scope: debugger HTTP + WebKit Inspector endpoints only; no binary decompilation

## Build

```powershell
gh auth login
git clone https://github.com/parallel42/p42-coherentgt-mcp.git
cd p42-coherentgt-mcp
docker build -t p42-coherentgt-mcp .
```

## MCP Config

JSON clients:

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

Codex TOML:

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

Restart the agent after changing MCP config.

## Manual Run

```powershell
docker run --rm -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  p42-coherentgt-mcp
```

## Env

| Variable | Default |
| --- | --- |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` |
| `COHERENT_GT_WS_TIMEOUT_MS` | `10000` |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` |

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Runtime/UI: `coherentgt_eval_js`, `coherentgt_trigger_event`, `coherentgt_call_engine`, `coherentgt_click`, `coherentgt_reload_view`, `coherentgt_navigate_view`
- DOM/CSS/resources: `coherentgt_get_document`, `coherentgt_query_selector`, `coherentgt_set_style`, `coherentgt_get_outer_html`, `coherentgt_get_matched_styles`, `coherentgt_get_stylesheets`, `coherentgt_get_stylesheet_text`, `coherentgt_get_resource_tree`, `coherentgt_get_resource_content`, `coherentgt_search_resource`, `coherentgt_get_native_document`
- Debugger: `coherentgt_debug_start`, `coherentgt_debug_stop`, `coherentgt_debug_status`, `coherentgt_debug_events`, `coherentgt_debug_command`, `coherentgt_debug_paused`, `coherentgt_debug_list_scripts`, `coherentgt_debug_get_script_source`, `coherentgt_debug_search_script`, `coherentgt_debug_search_all_scripts`, `coherentgt_debug_set_breakpoint_by_url`, `coherentgt_debug_set_breakpoint`, `coherentgt_debug_remove_breakpoint`, `coherentgt_debug_list_breakpoints`, `coherentgt_debug_pause`, `coherentgt_debug_resume`, `coherentgt_debug_step_over`, `coherentgt_debug_step_into`, `coherentgt_debug_step_out`, `coherentgt_debug_evaluate_on_call_frame`, `coherentgt_debug_set_event_listener_breakpoint`, `coherentgt_debug_set_xhr_breakpoint`, `coherentgt_debug_set_dom_breakpoint`

## Smoke Test

1. Start MSFS/Coherent debugger.
2. Open `http://127.0.0.1:19999/pagelist.json` on the host.
3. Build the image.
4. In the agent, call `coherentgt_health`, then `coherentgt_list_views`.

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, and navigate live views. Use only on local development targets you control.
