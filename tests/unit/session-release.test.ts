import { describe, expect, it } from "vitest";
import { releaseAllSessions, releasePageSessions } from "../../src/tools/session-release.js";

describe("session release helpers", () => {
  it("releases all persistent sockets for one page", () => {
    const calls: string[] = [];
    const state = {
      debugSessions: {
        stop: (pageId: number) => {
          calls.push(`debug:${pageId}`);
          return { pageId, stopped: true };
        }
      },
      profilingSessions: {
        release: (pageId: number) => {
          calls.push(`profile:${pageId}`);
          return { pageId, released: true };
        }
      },
      diagnosticSessions: {
        release: (pageId: number) => {
          calls.push(`diagnostic:${pageId}`);
          return { pageId, released: true };
        }
      }
    };

    expect(releasePageSessions(state, 12)).toEqual({
      pageId: 12,
      debug: { pageId: 12, stopped: true },
      profiling: { pageId: 12, released: true },
      diagnostics: { pageId: 12, released: true }
    });
    expect(calls).toEqual(["debug:12", "profile:12", "diagnostic:12"]);
  });

  it("releases every persistent socket manager", () => {
    const calls: string[] = [];
    const state = {
      debugSessions: {
        stopAll: () => {
          calls.push("debug");
          return { stopped: [1] };
        }
      },
      profilingSessions: {
        stopAll: () => {
          calls.push("profile");
          return { stopped: [2] };
        }
      },
      diagnosticSessions: {
        stopAll: () => {
          calls.push("diagnostic");
          return { stopped: [3] };
        }
      }
    };

    expect(releaseAllSessions(state)).toEqual({
      debug: { stopped: [1] },
      profiling: { stopped: [2] },
      diagnostics: { stopped: [3] }
    });
    expect(calls).toEqual(["debug", "profile", "diagnostic"]);
  });
});
