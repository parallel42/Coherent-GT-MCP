# CoherentGT MCP

Dockerized stdio MCP server for inspecting and controlling live Coherent GT/MSFS UI views through the Coherent debugger service.

- Host debugger: `http://127.0.0.1:19999/pagelist.json`
- Docker debugger URL: `http://host.docker.internal:19999`
- Transport: MCP stdio, no exposed Docker ports
- Scope: debugger HTTP + WebKit Inspector endpoints only; no binary decompilation

## Requirements

- Windows with Docker Desktop running Linux containers.
- A stdio-capable MCP client or agent.
- Coherent GT/MSFS debugger service enabled and reachable on the host at `http://127.0.0.1:19999/pagelist.json`.

Normal use does not require Git, GitHub CLI, Node.js, npm, or a source checkout.

If Docker Desktop is not already installed, install it from PowerShell:

```powershell
winget install --id Docker.DockerDesktop -e
```

After installing, restart PowerShell, start Docker Desktop, and verify Docker:

```powershell
docker version
```

Enable the Coherent GT/MSFS debugger or developer module in the simulator/add-on environment, then verify the host endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:19999/pagelist.json
```

Docker containers must target `http://host.docker.internal:19999`, not `http://127.0.0.1:19999`.

## Install

Pull the ready-to-run image:

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

No build step is required.

## MCP Config

JSON clients:

```json
{
  "mcpServers": {
    "coherent-gt-mcp": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--name",
        "coherent-gt-mcp",
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
  "--name",
  "coherent-gt-mcp",
  "-i",
  "-e",
  "COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999",
  "ghcr.io/parallel42/coherent-gt-mcp:latest"
]
```

Restart the agent after changing MCP config.

## Update

Pull the newest image:

```powershell
docker pull ghcr.io/parallel42/coherent-gt-mcp:latest
```

Then restart the agent that runs the MCP server.

## Manual Run

```powershell
docker run --rm --name coherent-gt-mcp -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  ghcr.io/parallel42/coherent-gt-mcp:latest
```

The fixed Docker name is intentional. Docker will reject a second concurrent MCP instance with the same name, which protects the Coherent debugger from stale parallel inspector sessions.

## Build From Source

This is optional. Normal users should use the published image above.

Download a source archive and build it with Docker:

```powershell
$zip = "$env:TEMP\coherent-gt-mcp.zip"
$src = "$env:TEMP\Coherent-GT-MCP-master"
Invoke-WebRequest https://github.com/parallel42/Coherent-GT-MCP/archive/refs/heads/master.zip -OutFile $zip
Remove-Item -Recurse -Force $src -ErrorAction SilentlyContinue
Expand-Archive $zip -DestinationPath $env:TEMP
docker build -t coherent-gt-mcp $src
```

Use the locally built image by replacing `ghcr.io/parallel42/coherent-gt-mcp:latest` with `coherent-gt-mcp` in the MCP config.

For local TypeScript development, install Node.js 20+ and run:

```powershell
npm ci
npm test
npm run build
```

## Env

| Variable | Default |
| --- | --- |
| `COHERENT_GT_DEBUGGER_URL` | `http://host.docker.internal:19999` |
| `COHERENT_GT_REQUEST_TIMEOUT_MS` | `5000` |
| `COHERENT_GT_WS_TIMEOUT_MS` | `30000` |
| `COHERENT_GT_MAX_TEXT_BYTES` | `262144` |
| `COHERENT_GT_IDLE_TIMEOUT_MS` | `3000000` |

`COHERENT_GT_IDLE_TIMEOUT_MS` is the idle process watchdog. The default is 50 minutes. Set it to `0` to disable automatic shutdown.

## Tools

- Health/views: `coherentgt_health`, `coherentgt_list_views`
- Runtime/UI: `coherentgt_eval_js`, `coherentgt_trigger_event`, `coherentgt_call_engine`, `coherentgt_click`, `coherentgt_reload_view`, `coherentgt_navigate_view`
- DOM/CSS/resources: `coherentgt_get_document`, `coherentgt_query_selector`, `coherentgt_set_style`, `coherentgt_get_outer_html`, `coherentgt_get_matched_styles`, `coherentgt_get_stylesheets`, `coherentgt_get_stylesheet_text`, `coherentgt_get_resource_tree`, `coherentgt_get_resource_content`, `coherentgt_search_resource`, `coherentgt_get_native_document`
- Debugger: `coherentgt_debug_start`, `coherentgt_debug_stop`, `coherentgt_debug_status`, `coherentgt_debug_events`, `coherentgt_debug_command`, `coherentgt_debug_paused`, `coherentgt_debug_list_scripts`, `coherentgt_debug_get_script_source`, `coherentgt_debug_search_script`, `coherentgt_debug_search_all_scripts`, `coherentgt_debug_set_breakpoint_by_url`, `coherentgt_debug_set_breakpoint`, `coherentgt_debug_remove_breakpoint`, `coherentgt_debug_list_breakpoints`, `coherentgt_debug_pause`, `coherentgt_debug_resume`, `coherentgt_debug_step_over`, `coherentgt_debug_step_into`, `coherentgt_debug_step_out`, `coherentgt_debug_evaluate_on_call_frame`, `coherentgt_debug_set_event_listener_breakpoint`, `coherentgt_debug_set_xhr_breakpoint`, `coherentgt_debug_set_dom_breakpoint`

## Smoke Test

1. Start MSFS/Coherent debugger.
2. Open `http://127.0.0.1:19999/pagelist.json` on the host.
3. Pull the Docker image.
4. Restart the agent with the MCP config above.
5. In the agent, call `coherentgt_health`, then `coherentgt_list_views`.

## Security

Tools can evaluate JS, click UI, trigger `engine` calls/events, reload, and navigate live views. Use only on local development targets you control.
