export type PageSessionReleaser = {
  debugSessions: {
    stop(pageId: number): unknown;
  };
  profilingSessions: {
    release(pageId: number): unknown;
  };
  diagnosticSessions: {
    release(pageId: number): unknown;
  };
};

export type AllSessionReleaser = {
  debugSessions: {
    stopAll(): unknown;
  };
  profilingSessions: {
    stopAll(): unknown;
  };
  diagnosticSessions: {
    stopAll(): unknown;
  };
};

export function releasePageSessions(state: PageSessionReleaser, pageId: number): Record<string, unknown> {
  return {
    pageId,
    debug: state.debugSessions.stop(pageId),
    profiling: state.profilingSessions.release(pageId),
    diagnostics: state.diagnosticSessions.release(pageId)
  };
}

export function releaseAllSessions(state: AllSessionReleaser): Record<string, unknown> {
  return {
    debug: state.debugSessions.stopAll(),
    profiling: state.profilingSessions.stopAll(),
    diagnostics: state.diagnosticSessions.stopAll()
  };
}
