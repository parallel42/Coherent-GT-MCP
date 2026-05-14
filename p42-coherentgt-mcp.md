# p42-coherentgt-mcp

## Summary
Create a new Git repository at `F:\Documents\Clients\Parallel 42\Git\p42-coherentgt-mcp` for a Dockerized TypeScript MCP server that controls live Coherent GT/MSFS UI views through the Coherent debugger service.

The first version will use the documented/observable debugger HTTP and WebKit Inspector endpoints, not binary decompilation. Local inspection confirmed:

- Existing repo naming favors `p42-*`.
- Coherent debugger service is reachable at `http://127.0.0.1:19999`.
- `/pagelist.json` returns `{ id, title, url, inspectorUrl }`.
- Inspector WebSocket URL is `ws://<host>/devtools/page/<pageId>`.
- Docker Desktop is available; container default target should be `http://host.docker.internal:19999`.
- MCP SDK latest local npm view: `@modelcontextprotocol/sdk@1.29.0`.

References:
- Coherent GT Debugging: https://coherent-labs.com/Documentation/cpp-gt/dd/d68/debugging.html
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP SDK index: https://modelcontextprotocol.io/docs/sdk

## Repository Shape
Create:

```text
p42-coherentgt-mcp/
  .dockerignore
  .gitignore
  Dockerfile
  README.md
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
      protocol.ts
      view-selector.ts
    tools/
      health.ts
      views.ts
      inspector.ts
      runtime.ts
      dom.ts
      css.ts
      navigation.ts
      events.ts
  tests/
    fixtures/
      pagelist.json
    unit/
      view-selector.test.ts
      debugger-client.test.ts
      tool-schemas.test.ts
```

Use npm, TypeScript, ESM, Node 20+.

## Runtime Defaults
Default environment:

```text
COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999
COHERENT_GT_REQUEST_TIMEOUT_MS=5000
COHERENT_GT_WS_TIMEOUT_MS=10000
COHERENT_GT_MAX_TEXT_BYTES=262144
```

Docker command target:

```powershell
docker run --rm -i `
  -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 `
  p42-coherentgt-mcp
```

No Docker port exposure is needed for v1 because MCP transport is stdio.

## Public MCP Interface
Expose full-control tools. Mutating tools must state that they affect the live Coherent view.

Tools:

- `coherentgt_health`
  - Input: `{}`
  - Checks debugger root and `/pagelist.json`.
  - Output: target URL, reachable boolean, page count, error if any.

- `coherentgt_list_views`
  - Input: optional `{ refresh?: boolean }`
  - Calls `/pagelist.json`.
  - Output: array of `{ id, title, url, inspectorUrl, websocketUrl }`.

- `coherentgt_inspector_command`
  - Input: `{ pageId: number, method: string, params?: object, timeoutMs?: number }`
  - Sends raw WebKit Inspector command over `ws://host/devtools/page/<pageId>`.
  - Output: raw protocol response.
  - This is the escape hatch for unsupported inspector domains.

- `coherentgt_eval_js`
  - Input: `{ pageId: number, expression: string, awaitPromise?: boolean, returnByValue?: boolean, timeoutMs?: number }`
  - Uses `Runtime.evaluate`.
  - Default `returnByValue: true`, `awaitPromise: false`.

- `coherentgt_trigger_event`
  - Input: `{ pageId: number, eventName: string, args?: unknown[] }`
  - Evaluates `engine.trigger(eventName, ...args)` in the page.
  - Mutates/communicates with the live game-side UI bridge if the page has `engine`.

- `coherentgt_call_engine`
  - Input: `{ pageId: number, functionName: string, args?: unknown[], awaitPromise?: boolean }`
  - Evaluates `engine.call(functionName, ...args)`.
  - Awaits promise by default.

- `coherentgt_get_document`
  - Input: `{ pageId: number, selector?: string, includeText?: boolean, maxDepth?: number }`
  - Uses JS DOM serialization, not a raw screenshot.
  - Default selector: `document.documentElement`.

- `coherentgt_query_selector`
  - Input: `{ pageId: number, selector: string, includeComputedStyle?: boolean }`
  - Returns matched node summary, text, attributes, rect, and optional computed style.

- `coherentgt_set_style`
  - Input: `{ pageId: number, selector: string, styles: Record<string,string> }`
  - Applies inline styles to all matched nodes.
  - Mutating.

- `coherentgt_click`
  - Input: `{ pageId: number, selector: string }`
  - Dispatches mouse events on the first matched element.
  - Mutating.

- `coherentgt_reload_view`
  - Input: `{ pageId: number, ignoreCache?: boolean }`
  - Uses inspector `Page.reload` if available; otherwise evaluates `location.reload()`.
  - Mutating.

- `coherentgt_navigate_view`
  - Input: `{ pageId: number, url: string }`
  - Navigates the view.
  - Mutating and should be documented as high-risk.

## Implementation Details
Use `@modelcontextprotocol/sdk@1.29.0`, `zod`, `typescript`, and `tsx` for local dev.

`debugger-client.ts`:
- Normalize base URL.
- Fetch `/pagelist.json`.
- Convert each `inspectorUrl` into `websocketUrl`:
  - page id path: `ws://<host>/devtools/page/<id>`
  - respect `COHERENT_GT_DEBUGGER_URL` host.
- Provide typed `InspectableView`.

`inspector-client.ts`:
- Open WebSocket per command, send one JSON-RPC-like inspector message with incrementing id, wait for matching response, close.
- Support event drainage until matching response.
- Apply timeout and return protocol errors without throwing away details.
- Keep this simple for v1; no long-lived connection pool.

`view-selector.ts`:
- Resolve by numeric `pageId` only for v1 tools.
- Do not guess by title in mutating tools.

`mcp-server.ts`:
- Register tools with Zod schemas.
- Return MCP `content: [{ type: "text", text: JSON.stringify(result, null, 2) }]`.
- Cap large text outputs using `COHERENT_GT_MAX_TEXT_BYTES`.

`index.ts`:
- Create server named `p42-coherentgt-mcp`.
- Connect with `StdioServerTransport`.
- Log diagnostics only to stderr.

## Dockerfile
Use a multi-stage Dockerfile:

```dockerfile
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

## README Content
Document:

- What the server does.
- Requirement: Coherent GT debugger/developer module must be enabled and reachable.
- Default MSFS/Coherent URL: `http://host.docker.internal:19999` in Docker.
- How to build:
  - `docker build -t p42-coherentgt-mcp .`
- How to run with MCP stdio:
  - `docker run --rm -i -e COHERENT_GT_DEBUGGER_URL=http://host.docker.internal:19999 p42-coherentgt-mcp`
- Example MCP client config using Docker command.
- Security warning: tools can evaluate JS, click UI, trigger `engine` events, reload, and navigate live views.
- Troubleshooting:
  - Test host endpoint: `http://127.0.0.1:19999/pagelist.json`
  - Docker target should be `host.docker.internal`, not `127.0.0.1`.
  - If views list is empty, ensure MSFS/Coherent debugger is active.

## Testing
Unit tests:

- Parse fixture `/pagelist.json`.
- Build websocket URLs from:
  - `http://host.docker.internal:19999`
  - `http://127.0.0.1:19999`
- Validate tool schemas accept good inputs and reject bad inputs.
- Verify JS serialization helpers escape args through `JSON.stringify`, never string concatenation.

Manual acceptance tests:

1. Start MSFS/Coherent debugger service.
2. Confirm host can open `http://127.0.0.1:19999/pagelist.json`.
3. Build Docker image.
4. Run MCP Inspector or a local MCP client against the Docker stdio command.
5. Call `coherentgt_health`; expect reachable and nonzero page count.
6. Call `coherentgt_list_views`; expect entries like `ATLAS`, `MAIN UI`, `Electronic Flight Bag`, `Toolbar`.
7. Call `coherentgt_eval_js` on a harmless expression:
   - `document.title`
8. Call `coherentgt_query_selector`:
   - selector `body`
9. Call mutating test only on a safe target:
   - `coherentgt_set_style` on `body` with a reversible outline style.
10. Call `coherentgt_inspector_command` with a basic Runtime command to prove raw protocol access.

## Reverse Engineering Policy
Do not decompile first. Use endpoint discovery and inspector protocol behavior first.

Only inspect/decompile binaries if:
- `/pagelist.json` and `/devtools/page/<id>` are insufficient,
- protocol methods differ from WebKit Inspector expectations,
- or there are hidden endpoints needed for screenshots/profiling.

If binary inspection becomes necessary, document findings in `docs/protocol-notes.md` without committing proprietary binaries or extracted copyrighted source.

## Assumptions
- The repository will be initialized as a new local Git repo.
- The first implementation is Dockerized stdio MCP only.
- Full-control tools are desired, including JS eval, event triggering, clicking, style mutation, reload, and navigation.
- Coherent debugger target default is `http://host.docker.internal:19999`.
- No native C++ bridge is included in v1.
- No shipped-product use is intended; this is a local development/debugging tool.
