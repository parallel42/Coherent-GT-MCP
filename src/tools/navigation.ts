export function pageReloadParams(ignoreCache: boolean): Record<string, unknown> {
  return { ignoreCache };
}

export function buildLocationReloadExpression(): string {
  return "location.reload()";
}

export function pageNavigateParams(url: string): Record<string, unknown> {
  return { url };
}
