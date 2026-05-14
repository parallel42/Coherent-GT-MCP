import { describe, expect, it } from "vitest";
import { coherentgtProfileCapabilities } from "../../src/tools/capabilities.js";

describe("profiling capabilities", () => {
  it("guides agents toward legacy profiling tools instead of Chrome-only domains", () => {
    const capabilities = coherentgtProfileCapabilities();

    expect(capabilities).toMatchObject({
      protocol: "Legacy WebKit Inspector as exposed by Coherent GT",
      legacyReplacements: {
        "Chrome Performance domain": expect.arrayContaining(["coherentgt_capture_all_start"]),
        "Chrome Profiler domain": expect.arrayContaining(["coherentgt_script_profile_start"]),
        "Chrome HeapProfiler or Runtime.getHeapUsage": expect.arrayContaining(["coherentgt_heap_snapshot"]),
        "Chrome network waterfall": expect.arrayContaining(["coherentgt_network_capture_start"])
      }
    });
    expect(JSON.stringify(capabilities)).toMatch(/restart/i);
  });
});
