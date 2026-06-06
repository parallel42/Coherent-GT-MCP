import { describe, expect, it, vi } from "vitest";
import { queryHostCorrelation, queryHostResourceResolution } from "../../src/tools/host-helper.js";

describe("host helper client", () => {
  it("reports unavailable when no helper URL is configured", async () => {
    await expect(queryHostCorrelation({ hostHelperUrl: null, processNames: [], logRoots: [] })).resolves.toEqual({
      available: false,
      reason: "COHERENT_GT_HOST_HELPER_URL is not configured"
    });
  });

  it("passes process and log-root filters to the helper", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.searchParams.get("processNames")).toBe("CoherentHost");
      expect(url.searchParams.get("logRoots")).toBe("C:\\Logs");
      return new Response(JSON.stringify({ available: true, processes: [], logs: [] }), { status: 200 });
    });

    await expect(
      queryHostCorrelation(
        {
          hostHelperUrl: "http://127.0.0.1:3344",
          processNames: ["CoherentHost"],
          logRoots: ["C:\\Logs"]
        },
        fetchMock as unknown as typeof fetch
      )
    ).resolves.toEqual({ available: true, processes: [], logs: [] });
  });

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
        return new Response(
          JSON.stringify({
            available: true,
            matches: [{ path: "C:\\CoherentResources\\example\\assets\\icon.png" }]
          }),
          { status: 200 }
        );
      }
    );

    expect(calls[0]).toContain("/resolve-resource");
    expect(calls[0]).toContain("resourceRoots=C%3A%5CCoherentResources");
    expect(result).toEqual({
      available: true,
      matches: [{ path: "C:\\CoherentResources\\example\\assets\\icon.png" }]
    });
  });
});
