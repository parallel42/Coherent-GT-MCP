# CoherentGT MCP Resilient Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP useful when Coherent GT runtime evaluation is slow or unavailable by adding resilient command handling, native selector/resource inspection, image probes, stronger diagnostics, and host resource correlation.

**Architecture:** Keep direct runtime JavaScript as one path, but stop making every high-value inspection tool depend on `Runtime.evaluate`. Add focused native WebInspector helpers for DOM/CSS/Page resource data, normalize timeout behavior, and expose compound MCP tools that return actionable debugging state in one call.

**Tech Stack:** TypeScript, Node.js 20, `ws`, `zod`, `@modelcontextprotocol/sdk`, Vitest.

---

## File Structure

- Modify `src/coherent/inspector-client.ts`: shared command timeout/error metadata and safer session close behavior.
- Modify `src/coherent/persistent-inspector.ts`: tolerant debugger startup and command capability tracking.
- Modify `src/tools/diagnostics.ts`: tolerant diagnostic startup, main-thread-busy reporting, richer network/image/resource summaries.
- Modify `src/tools/evaluate.ts`: normalized timeout result path for `coherentgt_evaluate`.
- Create `src/tools/selector-inspection.ts`: native `coherentgt_inspect_selector` implementation.
- Create `src/tools/resource-probe.ts`: `coherentgt_probe_resource` and image decode helper functions.
- Modify `src/tools/native-inspector.ts`: reusable native session utilities for DOM/CSS/Page calls.
- Modify `src/tools/host-helper.ts`: host-helper client support for URL-to-file resolution.
- Modify `scripts/coherentgt-host-helper.mjs`: add a `/resolve-resource` endpoint for local package file correlation.
- Modify `src/tools/schemas.ts`: schemas for new tools.
- Modify `src/mcp-server.ts`: register new tools and wire them through shared state.
- Modify `README.md` and `Coherent-GT-MCP.md`: document fallback behavior and recommended debugging workflow.
- Add or modify unit tests in `tests/unit/*.test.ts`.

## Task 1: Normalize Inspector Timeouts And Busy Runtime Results

**Files:**
- Modify: `src/coherent/inspector-client.ts`
- Modify: `src/tools/evaluate.ts`
- Test: `tests/unit/evaluate.test.ts`

- [ ] **Step 1: Write failing tests for timeout normalization**

Add these tests to `tests/unit/evaluate.test.ts`:

```ts
import { normalizeInspectorError } from "../../src/tools/evaluate.js";

it("normalizes inspector timeouts as main-thread busy candidates", () => {
  const result = normalizeInspectorError(new Error("Timed out after 1500ms waiting for Runtime.evaluate"), {
    method: "Runtime.evaluate",
    timeoutMs: 1500
  });

  expect(result).toEqual({
    wasThrown: true,
    type: "timeout",
    value: undefined,
    description: "Timed out after 1500ms waiting for Runtime.evaluate",
    exception: { text: "Timed out after 1500ms waiting for Runtime.evaluate" },
    stackFrames: [],
    timing: { timeoutMs: 1500 },
    likelyCause: "main-thread-busy"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/evaluate.test.ts
```

Expected: FAIL because `normalizeInspectorError` does not exist.

- [ ] **Step 3: Implement normalized timeout output**

In `src/tools/evaluate.ts`, extend `NormalizedEvaluateResult` and add:

```ts
export type NormalizedEvaluateResult = {
  value: unknown;
  type: string;
  subtype?: string | undefined;
  description?: string | undefined;
  wasThrown: boolean;
  exception?: { text: string; url?: string | undefined; line?: number | undefined; column?: number | undefined } | undefined;
  stackFrames: unknown[];
  risk?: EvaluateRisk | undefined;
  warnings?: string[] | undefined;
  timing?: { timeoutMs?: number | undefined; elapsedMs?: number | undefined } | undefined;
  likelyCause?: "main-thread-busy" | "inspector-session-closed" | "inspector-error" | undefined;
};

export function normalizeInspectorError(error: unknown, context: { method: string; timeoutMs?: number | undefined }): NormalizedEvaluateResult {
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = message.includes("Timed out") || message.toLowerCase().includes("timeout");
  const sessionClosed = message.includes("session closed") || message.includes("session is not open");

  return {
    wasThrown: true,
    type: isTimeout ? "timeout" : "error",
    value: undefined,
    description: message,
    exception: { text: message },
    stackFrames: [],
    timing: { timeoutMs: context.timeoutMs },
    likelyCause: isTimeout && context.method === "Runtime.evaluate" ? "main-thread-busy" : sessionClosed ? "inspector-session-closed" : "inspector-error"
  };
}
```

Update `coherentgtEvaluate` to catch errors from `coherentgtInspectorCommand` and return `normalizeInspectorError(error, { method: "Runtime.evaluate", timeoutMs: options.timeoutMs })` instead of letting the MCP wrapper turn it into a generic tool error.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/unit/evaluate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/evaluate.ts tests/unit/evaluate.test.ts
git commit -m "feat: normalize runtime evaluation timeouts"
```

## Task 2: Make Persistent Sessions Tolerant Of Unsupported Or Stalled Enable Commands

**Files:**
- Modify: `src/coherent/persistent-inspector.ts`
- Modify: `src/tools/diagnostics.ts`
- Test: `tests/unit/diagnostics.test.ts`
- Test: `tests/unit/debugger-client.test.ts`

- [ ] **Step 1: Write failing unit tests for tolerant enable behavior**

In `tests/unit/diagnostics.test.ts`, add tests around a new exported helper:

```ts
import { summarizeStartupCommandResults } from "../../src/tools/diagnostics.js";

it("keeps diagnostic startup usable when Runtime.enable fails", () => {
  expect(
    summarizeStartupCommandResults([
      { method: "Runtime.enable", ok: false, error: "Inspector session closed while waiting for Runtime.enable" },
      { method: "Console.enable", ok: true },
      { method: "Page.enable", ok: true }
    ])
  ).toEqual({
    supported: ["Console.enable", "Page.enable"],
    unsupported: ["Runtime.enable"],
    errors: [{ method: "Runtime.enable", error: "Inspector session closed while waiting for Runtime.enable" }]
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/unit/diagnostics.test.ts tests/unit/debugger-client.test.ts
```

Expected: FAIL because `summarizeStartupCommandResults` does not exist and debugger startup still hard-fails on the first enable command.

- [ ] **Step 3: Implement tolerant startup for diagnostics**

In `src/tools/diagnostics.ts`, replace the sequential startup loop with captured results:

```ts
export type StartupCommandResult = { method: string; ok: boolean; error?: string | undefined };

export function summarizeStartupCommandResults(results: StartupCommandResult[]): {
  supported: string[];
  unsupported: string[];
  errors: Array<{ method: string; error: string }>;
} {
  return {
    supported: results.filter((entry) => entry.ok).map((entry) => entry.method),
    unsupported: results.filter((entry) => !entry.ok).map((entry) => entry.method),
    errors: results
      .filter((entry): entry is StartupCommandResult & { error: string } => !entry.ok && typeof entry.error === "string")
      .map((entry) => ({ method: entry.method, error: entry.error }))
  };
}
```

In `DiagnosticSession.ensureOpen`, use `tryCommand` for all enable commands and never throw solely because one enable command failed:

```ts
const startupResults: StartupCommandResult[] = [];
for (const method of DEFAULT_ENABLE_COMMANDS) {
  const result = await this.tryCommand(method);
  startupResults.push({ method, ok: result.ok, error: result.error });
}
this.startup = summarizeStartupCommandResults(startupResults);
```

Add `startup` to `status()`.

- [ ] **Step 4: Implement tolerant startup for debug sessions**

In `src/coherent/persistent-inspector.ts`, add a `capability` map and a private `tryCommand` method matching the diagnostics behavior. In `start`, treat `Debugger.enable` as required, but make `Runtime.enable` and `Page.enable` optional:

```ts
await this.tryCommand("Runtime.enable");
await this.tryCommand("Page.enable");
const debuggerEnable = await this.tryCommand("Debugger.enable");
if (!debuggerEnable.ok) {
  throw new Error(`Debugger.enable failed: ${debuggerEnable.error}`);
}
await this.tryCommand("Debugger.setBreakpointsActive", { active: true });
await this.tryCommand("Debugger.setPauseOnExceptions", { state: options.pauseOnExceptions ?? "none" });
```

Add `supported` and `unsupported` arrays to `status()`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/unit/diagnostics.test.ts tests/unit/debugger-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/diagnostics.ts src/coherent/persistent-inspector.ts tests/unit/diagnostics.test.ts tests/unit/debugger-client.test.ts
git commit -m "feat: tolerate partial inspector startup"
```

## Task 3: Add Native Inspect Selector Tool

**Files:**
- Create: `src/tools/selector-inspection.ts`
- Modify: `src/tools/schemas.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/unit/selector-inspection.test.ts`
- Test: `tests/unit/tool-schemas.test.ts`

- [ ] **Step 1: Write schema test**

In `tests/unit/tool-schemas.test.ts`, import `inspectSelectorInputSchema` and add:

```ts
it("accepts inspect selector inputs", () => {
  expect(
    inspectSelectorInputSchema.parse({
      pageId: 9,
      selector: "body",
      includeMatchedRules: true
    })
  ).toEqual({
    pageId: 9,
    selector: "body",
    includeComputedStyle: true,
    includeMatchedRules: true,
    includeOuterHtml: true
  });
});
```

- [ ] **Step 2: Write helper test**

Create `tests/unit/selector-inspection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeSelectorInspection } from "../../src/tools/selector-inspection.js";

describe("selector inspection", () => {
  it("summarizes visibility from computed style and box model", () => {
    expect(
      summarizeSelectorInspection({
        selector: "body",
        nodeId: 42,
        computedStyle: [
          { name: "display", value: "block" },
          { name: "visibility", value: "visible" },
          { name: "opacity", value: "1" }
        ],
        boxModel: {
          model: {
            width: 640,
            height: 480,
            content: [0, 0, 640, 0, 640, 480, 0, 480]
          }
        },
        outerHTML: "<body></body>"
      })
    ).toMatchObject({
      selector: "body",
      found: true,
      nodeId: 42,
      visibility: {
        display: "block",
        visibility: "visible",
        opacity: 1,
        hasBox: true,
        visible: true
      },
      boundingBox: { x: 0, y: 0, width: 640, height: 480 }
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/unit/tool-schemas.test.ts tests/unit/selector-inspection.test.ts
```

Expected: FAIL because the schema and module do not exist.

- [ ] **Step 4: Add schema**

In `src/tools/schemas.ts`, add:

```ts
export const inspectSelectorInputSchema = z
  .object({
    pageId: pageIdSchema,
    selector: z.string().min(1),
    includeComputedStyle: z.boolean().optional().default(true),
    includeMatchedRules: z.boolean().optional().default(false),
    includeOuterHtml: z.boolean().optional().default(true)
  })
  .strict();
```

- [ ] **Step 5: Implement native selector inspection**

Create `src/tools/selector-inspection.ts` with a native path that uses `DOM.getDocument`, `DOM.querySelector`, `DOM.getBoxModel`, `CSS.enable`, `CSS.getComputedStyleForNode`, `CSS.getMatchedStylesForNode`, and `DOM.getOuterHTML`. Return per-subcommand errors rather than failing the whole tool when CSS is unsupported:

```ts
import type { InspectorCommandResult } from "../coherent/protocol.js";
import { coherentgtInspectorSession } from "./inspector.js";

export async function inspectSelector(
  options: { debuggerUrl: string; pageId: number; timeoutMs: number },
  input: { selector: string; includeComputedStyle: boolean; includeMatchedRules: boolean; includeOuterHtml: boolean }
): Promise<unknown> {
  return await coherentgtInspectorSession(options, async (send) => {
    const root = readRecord(extractResult("DOM.getDocument", await send("DOM.getDocument")));
    const rootNodeId = readRecord(root.root).nodeId;
    if (typeof rootNodeId !== "number") {
      throw new Error("DOM.getDocument did not return a root node id");
    }

    const query = readRecord(
      extractResult("DOM.querySelector", await send("DOM.querySelector", { nodeId: rootNodeId, selector: input.selector }))
    );
    const nodeId = query.nodeId;
    if (typeof nodeId !== "number" || nodeId <= 0) {
      return { selector: input.selector, found: false };
    }

    const boxModel = await optionalCommand(send, "DOM.getBoxModel", { nodeId });
    const computedStyle = input.includeComputedStyle
      ? await optionalCommand(send, "CSS.getComputedStyleForNode", { nodeId }, "CSS.enable")
      : undefined;
    const matchedRules = input.includeMatchedRules
      ? await optionalCommand(send, "CSS.getMatchedStylesForNode", { nodeId }, "CSS.enable")
      : undefined;
    const outerHTML = input.includeOuterHtml ? await optionalCommand(send, "DOM.getOuterHTML", { nodeId }) : undefined;

    return summarizeSelectorInspection({
      selector: input.selector,
      nodeId,
      boxModel: boxModel.ok ? boxModel.result : undefined,
      computedStyle: computedStyle?.ok ? readRecord(computedStyle.result).computedStyle : undefined,
      matchedRules: matchedRules?.ok ? matchedRules.result : undefined,
      outerHTML: outerHTML?.ok ? readRecord(outerHTML.result).outerHTML : undefined,
      errors: [boxModel, computedStyle, matchedRules, outerHTML].filter((entry) => entry && !entry.ok)
    });
  });
}
```

Also implement `summarizeSelectorInspection`, `optionalCommand`, `extractResult`, and small `readRecord` helpers in the same file.

- [ ] **Step 6: Register MCP tool**

In `src/mcp-server.ts`, import `inspectSelectorInputSchema` and `inspectSelector`, then register:

```ts
server.registerTool(
  "coherentgt_inspect_selector",
  {
    title: "Inspect Selector",
    description:
      "Return DOM existence, node id, outer HTML, computed style, box model, visibility, and optional matched CSS rules for one selector using native WebInspector domains where possible.",
    inputSchema: inspectSelectorInputSchema
  },
  async (args: z.infer<typeof inspectSelectorInputSchema>) =>
    run(() =>
      inspectSelector(
        {
          debuggerUrl: config.debuggerUrl,
          pageId: args.pageId,
          timeoutMs: config.wsTimeoutMs
        },
        args
      )
    )
);
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- tests/unit/tool-schemas.test.ts tests/unit/selector-inspection.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/schemas.ts src/tools/selector-inspection.ts src/mcp-server.ts tests/unit/tool-schemas.test.ts tests/unit/selector-inspection.test.ts
git commit -m "feat: add native selector inspection"
```

## Task 4: Add Resource Probe For coui:// Assets

**Files:**
- Create: `src/tools/resource-probe.ts`
- Modify: `src/tools/schemas.ts`
- Modify: `src/mcp-server.ts`
- Modify: `src/tools/diagnostics.ts`
- Test: `tests/unit/resource-probe.test.ts`
- Test: `tests/unit/tool-schemas.test.ts`

- [ ] **Step 1: Write resource probe tests**

Create `tests/unit/resource-probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeResourceProbe } from "../../src/tools/resource-probe.js";

describe("resource probe", () => {
  it("reports loaded resource content length and MIME metadata", () => {
    expect(
      summarizeResourceProbe({
        url: "coui://example/assets/icon.png",
        resource: { url: "coui://example/assets/icon.png", type: "Image", mimeType: "image/png" },
        content: { content: "abcd", base64Encoded: true },
        network: { status: 200, encodedDataLength: 1234 }
      })
    ).toEqual({
      url: "coui://example/assets/icon.png",
      foundInResourceTree: true,
      type: "Image",
      mimeType: "image/png",
      byteLength: 3,
      base64Encoded: true,
      network: { status: 200, encodedDataLength: 1234 },
      warnings: []
    });
  });
});
```

- [ ] **Step 2: Write schema test**

In `tests/unit/tool-schemas.test.ts`, import `resourceProbeInputSchema` and add:

```ts
it("accepts resource probe inputs", () => {
  expect(
    resourceProbeInputSchema.parse({
      pageId: 9,
      url: "coui://example/assets/icon.png"
    })
  ).toEqual({
    pageId: 9,
    url: "coui://example/assets/icon.png",
    includeContent: true,
    includeNetwork: true
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts
```

Expected: FAIL because the new module and schema do not exist.

- [ ] **Step 4: Add schema**

In `src/tools/schemas.ts`, add:

```ts
export const resourceProbeInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    includeContent: z.boolean().optional().default(true),
    includeNetwork: z.boolean().optional().default(true),
    frameId: z.string().min(1).optional()
  })
  .strict();
```

- [ ] **Step 5: Implement resource probe**

Create `src/tools/resource-probe.ts` with:

```ts
export function summarizeResourceProbe(input: {
  url: string;
  resource?: Record<string, unknown> | undefined;
  content?: { content?: string | undefined; base64Encoded?: boolean | undefined } | undefined;
  network?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const base64Encoded = input.content?.base64Encoded === true;
  const content = input.content?.content ?? "";
  const byteLength = input.content
    ? base64Encoded
      ? Buffer.byteLength(content, "base64")
      : Buffer.byteLength(content, "utf8")
    : undefined;
  const warnings = [];
  if (!input.resource) warnings.push("Resource was not found in Page.getResourceTree.");
  if (input.content && byteLength === 0) warnings.push("Resource content was empty.");

  return compactUndefined({
    url: input.url,
    foundInResourceTree: !!input.resource,
    type: input.resource?.type,
    mimeType: input.resource?.mimeType,
    byteLength,
    base64Encoded: input.content ? base64Encoded : undefined,
    network: input.network,
    warnings
  });
}
```

Add `probeResource(options, input)` that opens one native inspector session, reads `Page.getResourceTree`, finds the requested URL, optionally reads `Page.getResourceContent`, and optionally receives a network row from `DiagnosticSessionManager`.

- [ ] **Step 6: Add diagnostic network lookup**

In `src/tools/diagnostics.ts`, add a public method:

```ts
async networkForUrl(pageId: number, url: string): Promise<Record<string, unknown> | undefined> {
  const session = await this.ready(pageId);
  const summary = summarizeNetworkEvents(session.listEvents({ maxEvents: 5000 }), { maxPayloadChars: 240 });
  return summary.requests.find((entry) => readRecord(entry).url === url) as Record<string, unknown> | undefined;
}
```

- [ ] **Step 7: Register MCP tool**

Register `coherentgt_probe_resource` in `src/mcp-server.ts`. Use `diagnosticSessions.networkForUrl` only when `includeNetwork` is true. Return resource tree status, MIME type, byte length, network status, failed-load error text, and warnings.

- [ ] **Step 8: Run tests**

Run:

```bash
npm test -- tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts tests/unit/diagnostics.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/tools/resource-probe.ts src/tools/schemas.ts src/tools/diagnostics.ts src/mcp-server.ts tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts
git commit -m "feat: add coui resource probe"
```

## Task 5: Add Image-Specific Diagnostics

**Files:**
- Modify: `src/tools/resource-probe.ts`
- Modify: `src/tools/schemas.ts`
- Modify: `src/mcp-server.ts`
- Test: `tests/unit/resource-probe.test.ts`
- Test: `tests/unit/tool-schemas.test.ts`

- [ ] **Step 1: Write tests for image probe expression**

In `tests/unit/resource-probe.test.ts`, add:

```ts
import { buildImageProbeExpression } from "../../src/tools/resource-probe.js";

it("builds an old-WebKit-compatible image decode probe", () => {
  const expression = buildImageProbeExpression("coui://example/assets/icon.png", 2500);

  expect(expression).toContain("new Image()");
  expect(expression).toContain("naturalWidth");
  expect(expression).toContain("onerror");
  expect(expression).not.toContain("async");
  expect(expression).not.toContain("Promise");
  expect(expression).not.toContain("=>");
});
```

- [ ] **Step 2: Write schema test**

In `tests/unit/tool-schemas.test.ts`, import `imageProbeInputSchema` and add:

```ts
it("accepts image probe inputs", () => {
  expect(imageProbeInputSchema.parse({ pageId: 9, url: "coui://example/assets/icon.png" })).toEqual({
    pageId: 9,
    url: "coui://example/assets/icon.png",
    timeoutMs: 5000,
    includeResourceProbe: true
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts
```

Expected: FAIL because image probe schema and expression do not exist.

- [ ] **Step 4: Add schema**

In `src/tools/schemas.ts`, add:

```ts
export const imageProbeInputSchema = z
  .object({
    pageId: pageIdSchema,
    url: z.string().min(1),
    timeoutMs: z.number().int().positive().max(30000).optional().default(5000),
    includeResourceProbe: z.boolean().optional().default(true)
  })
  .strict();
```

- [ ] **Step 5: Implement image probe expression**

In `src/tools/resource-probe.ts`, add:

```ts
export function buildImageProbeExpression(url: string, timeoutMs: number): string {
  return `(() => {
  var done = false;
  var img = new Image();
  var startedAt = Date.now();
  var timeoutMs = ${Math.max(1, Math.min(timeoutMs, 30000))};
  return new Promise(function(resolve) {
    function finish(result) {
      if (done) return;
      done = true;
      result.elapsedMs = Date.now() - startedAt;
      resolve(result);
    }
    img.onload = function() {
      finish({
        loaded: true,
        error: null,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete
      });
    };
    img.onerror = function() {
      finish({
        loaded: false,
        error: "image load failed",
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        complete: img.complete
      });
    };
    setTimeout(function() {
      finish({
        loaded: false,
        error: "timeout",
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        complete: img.complete
      });
    }, timeoutMs);
    img.src = ${JSON.stringify(url)};
  });
})()`;
}
```

Use `coherentgtEvaluate` with `awaitPromise: true`, `returnByValue: true`, `risk: "read-only"`, and `timeoutMs: input.timeoutMs + 1000`. Include the resource probe summary when `includeResourceProbe` is true.

- [ ] **Step 6: Register MCP tool**

Register `coherentgt_probe_image` in `src/mcp-server.ts`. The output should include:

```ts
{
  url,
  runtimeDecode: normalizedEvaluateResult,
  resource?: resourceProbeResult,
  verdict: "decoded" | "request-failed" | "decode-failed" | "main-thread-busy" | "unknown"
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts tests/unit/evaluate.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tools/resource-probe.ts src/tools/schemas.ts src/mcp-server.ts tests/unit/resource-probe.test.ts tests/unit/tool-schemas.test.ts
git commit -m "feat: add image decode diagnostics"
```

## Task 6: Correlate coui:// URLs To Local Resource Files

**Files:**
- Modify: `scripts/coherentgt-host-helper.mjs`
- Modify: `src/tools/host-helper.ts`
- Modify: `src/tools/resource-probe.ts`
- Modify: `src/config.ts`
- Test: `tests/unit/host-helper.test.ts`
- Test: `tests/unit/resource-probe.test.ts`

- [ ] **Step 1: Write host helper client tests**

In `tests/unit/host-helper.test.ts`, add:

```ts
import { queryHostResourceResolution } from "../../src/tools/host-helper.js";

it("queries host helper resource resolution", async () => {
  const calls: string[] = [];
  const result = await queryHostResourceResolution(
    {
      hostHelperUrl: "http://127.0.0.1:3344",
      processNames: [],
      logRoots: [],
      resourceRoots: ["C:\\CoherentResources"]
    },
    "coui://example/assets/icon.png",
    async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ available: true, matches: [{ path: "C:\\CoherentResources\\example\\assets\\icon.png" }] }), {
        status: 200
      });
    }
  );

  expect(calls[0]).toContain("/resolve-resource");
  expect(result).toEqual({
    available: true,
    matches: [{ path: "C:\\CoherentResources\\example\\assets\\icon.png" }]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/host-helper.test.ts
```

Expected: FAIL because `queryHostResourceResolution` and `resourceRoots` do not exist.

- [ ] **Step 3: Extend config**

In `src/config.ts`, add `hostHelperResourceRoots` parsed from `COHERENT_GT_HOST_HELPER_RESOURCE_ROOTS` using the same `|` separator as log roots.

- [ ] **Step 4: Add host helper endpoint**

In `scripts/coherentgt-host-helper.mjs`, add a `/resolve-resource` endpoint. Inputs:

- `url`: required `coui://...` URL.
- `resourceRoots`: optional `|`-separated local directories.

Resolution strategy:

- Normalize `coui://example/assets/icon.png` into candidate suffixes such as `example/assets/icon.png`, `assets/icon.png`, and `icon.png`.
- Search configured resource roots recursively for matching suffixes.
- Return at most 20 matches with `path`, `bytes`, and `lastWriteTime`.

- [ ] **Step 5: Add host helper client**

In `src/tools/host-helper.ts`, extend `HostCorrelationOptions`:

```ts
export type HostCorrelationOptions = {
  hostHelperUrl: string | null;
  processNames: string[];
  logRoots: string[];
  resourceRoots?: string[] | undefined;
};
```

Add `queryHostResourceResolution(options, resourceUrl, fetchFn = fetch)`.

- [ ] **Step 6: Include physical path in resource probe**

In `src/tools/resource-probe.ts`, include `hostResolution` when a host helper URL is configured. `coherentgt_probe_resource` should return the physical path candidates alongside MIME/status/byte-length data.

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- tests/unit/host-helper.test.ts tests/unit/resource-probe.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/coherentgt-host-helper.mjs src/config.ts src/tools/host-helper.ts src/tools/resource-probe.ts tests/unit/host-helper.test.ts tests/unit/resource-probe.test.ts
git commit -m "feat: correlate coui resources to local files"
```

## Task 7: Strengthen diagnose_page Into A One-Call Triage Tool

**Files:**
- Modify: `src/tools/diagnostics.ts`
- Modify: `src/tools/schemas.ts`
- Test: `tests/unit/diagnostics.test.ts`
- Test: `tests/unit/tool-schemas.test.ts`

- [ ] **Step 1: Write schema test for selectors/resources/images**

In `tests/unit/tool-schemas.test.ts`, update `diagnosePageInputSchema` test coverage:

```ts
expect(
  diagnosePageInputSchema.parse({
    pageId: 9,
    selectors: ["body"],
    resources: ["coui://example/assets/app.js"],
    images: ["coui://example/assets/icon.png"]
  })
).toEqual({
  pageId: 9,
  sampleMs: 750,
  consoleLevels: ["error", "warning"],
  selectors: ["body"],
  resources: ["coui://example/assets/app.js"],
  images: ["coui://example/assets/icon.png"]
});
```

- [ ] **Step 2: Add schema fields**

In `src/tools/schemas.ts`, extend `diagnosePageInputSchema`:

```ts
selectors: z.array(z.string().min(1)).max(20).optional(),
resources: z.array(z.string().min(1)).max(50).optional(),
images: z.array(z.string().min(1)).max(20).optional()
```

- [ ] **Step 3: Add diagnostic sections**

In `src/tools/diagnostics.ts`, update `diagnosePage` to include:

- `runtime.status`: success, timeout, unsupported, or not-probed.
- `selectors`: summaries from `coherentgt_inspect_selector` for requested selectors.
- `resourceProbes`: summaries from `coherentgt_probe_resource` for requested resources.
- `imageProbes`: summaries from `coherentgt_probe_image` for requested images.

Limit each section to bounded payloads and return per-item errors.

- [ ] **Step 4: Update likely cause rules**

Add these rules to `buildLikelyCauses`:

- Runtime timeout: `"Runtime.evaluate timed out; the main thread may be busy or the target may be rejecting Runtime commands."`
- Selector missing: `"Requested selector did not match a DOM node."`
- Image request failed: `"Image request failed or did not decode."`
- Resource missing: `"Requested resource was not present in Page.getResourceTree."`

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/unit/diagnostics.test.ts tests/unit/tool-schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/diagnostics.ts src/tools/schemas.ts tests/unit/diagnostics.test.ts tests/unit/tool-schemas.test.ts
git commit -m "feat: expand page diagnostics triage"
```

## Task 8: Document Agent Workflow And Tool Selection

**Files:**
- Modify: `README.md`
- Modify: `Coherent-GT-MCP.md`

- [ ] **Step 1: Update README tool list**

Add the new tools:

- `coherentgt_inspect_selector`
- `coherentgt_probe_resource`
- `coherentgt_probe_image`

- [ ] **Step 2: Add recommended generic page triage sequence**

Document this workflow:

```text
1. coherentgt_list_pages with title/url filters that identify the target Coherent page.
2. coherentgt_diagnose_page with caller-provided selectors and suspect JS/CSS/image URLs.
3. coherentgt_inspect_selector for a caller-provided selector.
4. coherentgt_probe_resource for loaded JS/CSS and suspect coui:// images.
5. coherentgt_probe_image for image decode verification.
6. coherentgt_reload_view, coherentgt_navigate_view, coherentgt_click, or coherentgt_trigger_event only when a mutating generic page action is explicitly needed.
```

- [ ] **Step 3: Document timeout semantics**

Add: when `Runtime.evaluate` times out, tools should return `likelyCause: "main-thread-busy"` when possible. Agents should prefer native DOM/CSS/resource tools before retrying runtime evaluation.

- [ ] **Step 4: Run docs-free verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md Coherent-GT-MCP.md
git commit -m "docs: document resilient CoherentGT inspection workflow"
```

## Execution Notes

- Implement Tasks 1 through 5 first. These directly address the blocking inspection failures without requiring product-specific runtime knowledge.
- Task 6 depends on the host helper running with configured local resource roots.
- Task 7 should stay bounded. Do not make `coherentgt_diagnose_page` fetch every resource automatically; it should probe only requested selectors/resources/images plus compact summaries.
- Page-content-specific helpers are out of scope. New tools must not assume named apps, routes, panels, CSS classes, DOM roots, or product-specific globals; selectors and URLs are always caller-provided.

## Self-Review

- Spec coverage:
  - Stable simple JS evaluation: Tasks 1 and 2 normalize timeouts and prevent generic blocking failures.
  - DOM/computed style inspection: Task 3 adds native `coherentgt_inspect_selector`.
  - Resource content/search reliability: Task 4 adds a direct resource probe and Task 7 integrates it into diagnostics.
  - Network image request and decode details: Tasks 4 and 5 cover network/resource metadata plus runtime image decode.
  - Eval fallback/main-thread-busy: Tasks 1, 2, and 7 return structured timeout causes.
  - Local resource correlation: Task 6 adds host-helper URL-to-file resolution.
- Placeholder scan: no unresolved placeholder markers or unspecified implementation steps remain.
- Type consistency: new schemas, helper names, and MCP tool names are consistent across tasks.
