export type HostCorrelationOptions = {
  hostHelperUrl: string | null;
  processNames: string[];
  logRoots: string[];
  resourceRoots?: string[] | undefined;
};

export async function queryHostCorrelation(
  options: HostCorrelationOptions,
  fetchFn: typeof fetch = fetch
): Promise<unknown> {
  if (!options.hostHelperUrl) {
    return {
      available: false,
      reason: "COHERENT_GT_HOST_HELPER_URL is not configured"
    };
  }

  const url = new URL("/correlate", options.hostHelperUrl);
  if (options.processNames.length > 0) {
    url.searchParams.set("processNames", options.processNames.join(","));
  }
  if (options.logRoots.length > 0) {
    url.searchParams.set("logRoots", options.logRoots.join("|"));
  }

  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      return {
        available: false,
        reason: `Host helper returned HTTP ${response.status}`
      };
    }
    return (await response.json()) as unknown;
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function queryHostResourceResolution(
  options: HostCorrelationOptions,
  resourceUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<unknown> {
  if (!options.hostHelperUrl) {
    return {
      available: false,
      reason: "COHERENT_GT_HOST_HELPER_URL is not configured"
    };
  }

  const url = new URL("/resolve-resource", options.hostHelperUrl);
  url.searchParams.set("url", resourceUrl);
  if (options.resourceRoots && options.resourceRoots.length > 0) {
    url.searchParams.set("resourceRoots", options.resourceRoots.join("|"));
  }

  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      return {
        available: false,
        reason: `Host helper returned HTTP ${response.status}`
      };
    }
    return (await response.json()) as unknown;
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
