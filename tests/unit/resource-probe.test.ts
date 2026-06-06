import { describe, expect, it } from "vitest";
import { buildImageProbeExpression, imageProbeVerdict, summarizeResourceProbe } from "../../src/tools/resource-probe.js";

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

  it("builds an old-WebKit-compatible image decode probe", () => {
    const expression = buildImageProbeExpression("coui://example/assets/icon.png", 2500);

    expect(expression).toContain("new Image()");
    expect(expression).toContain("naturalWidth");
    expect(expression).toContain("onerror");
    expect(expression).toContain("Promise");
    expect(expression).not.toContain("async");
    expect(expression).not.toContain("=>");
  });

  it("classifies image probe outcomes", () => {
    expect(imageProbeVerdict({ likelyCause: "main-thread-busy" })).toBe("main-thread-busy");
    expect(imageProbeVerdict({ value: { loaded: true, naturalWidth: 16, naturalHeight: 16 } })).toBe("decoded");
    expect(imageProbeVerdict({ value: { loaded: false, error: "image load failed" } })).toBe("decode-failed");
  });
});
