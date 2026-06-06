#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const host = process.env.COHERENT_GT_HOST_HELPER_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.COHERENT_GT_HOST_HELPER_PORT || "3344", 10);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (url.pathname === "/health") {
      writeJson(res, 200, { ok: true, service: "coherentgt-host-helper" });
      return;
    }

    if (url.pathname === "/resolve-resource") {
      const resourceUrl = url.searchParams.get("url");
      if (!resourceUrl) {
        writeJson(res, 400, { available: false, reason: "Missing required url parameter" });
        return;
      }

      const resourceRoots = splitList(url.searchParams.get("resourceRoots"), "|");
      const matches = await resolveResource(resourceUrl, resourceRoots);
      writeJson(res, 200, {
        available: true,
        generatedAt: new Date().toISOString(),
        url: resourceUrl,
        matches
      });
      return;
    }

    if (url.pathname !== "/correlate") {
      writeJson(res, 404, { available: false, reason: "Not found" });
      return;
    }

    const processNames = splitList(url.searchParams.get("processNames"), ",");
    const logRoots = splitList(url.searchParams.get("logRoots"), "|");
    const [processes, logs] = await Promise.all([queryProcesses(processNames), queryLogs(logRoots)]);

    writeJson(res, 200, {
      available: true,
      generatedAt: new Date().toISOString(),
      processes,
      logs,
      warnings: staleLogWarnings(processes, logs)
    });
  } catch (error) {
    writeJson(res, 500, {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.error(`coherentgt-host-helper listening on http://${host}:${port}`);
});

function splitList(value, separator) {
  if (!value) return [];
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function queryProcesses(processNames) {
  if (processNames.length === 0) {
    return [];
  }

  const namesLiteral = processNames.map((name) => `'${escapePowerShellString(name)}'`).join(",");
  const script = `
$names = @(${namesLiteral})
Get-Process -Name $names -ErrorAction SilentlyContinue |
  Select-Object Id, ProcessName, Path, StartTime |
  ConvertTo-Json -Depth 4
`;
  const value = await runPowerShellJson(script);
  return normalizeArray(value).map((entry) => ({
    pid: entry.Id,
    name: entry.ProcessName,
    path: entry.Path || null,
    startTime: entry.StartTime || null
  }));
}

async function queryLogs(logRoots) {
  if (logRoots.length === 0) {
    return [];
  }

  const rootsLiteral = logRoots.map((root) => `'${escapePowerShellString(root)}'`).join(",");
  const script = `
$roots = @(${rootsLiteral})
$items = @()
foreach ($root in $roots) {
  if (Test-Path -LiteralPath $root) {
    $items += Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 20 FullName, Length, LastWriteTime
  }
}

async function resolveResource(resourceUrl, resourceRoots) {
  if (resourceRoots.length === 0) {
    return [];
  }

  const suffixes = resourceSuffixes(resourceUrl);
  if (suffixes.length === 0) {
    return [];
  }

  const rootsLiteral = resourceRoots.map((root) => `'${escapePowerShellString(root)}'`).join(",");
  const suffixesLiteral = suffixes.map((suffix) => `'${escapePowerShellString(suffix)}'`).join(",");
  const script = `
$roots = @(${rootsLiteral})
$suffixes = @(${suffixesLiteral})
$items = @()
foreach ($root in $roots) {
  if (Test-Path -LiteralPath $root) {
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    Get-ChildItem -LiteralPath $rootFull -Recurse -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        $full = [System.IO.Path]::GetFullPath($_.FullName)
        $relative = $full.Substring($rootFull.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        $relativeForward = $relative -replace '\\\\', '/'
        foreach ($suffix in $suffixes) {
          if ($relativeForward.EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $items += [PSCustomObject]@{
              Path = $_.FullName
              Length = $_.Length
              LastWriteTime = $_.LastWriteTime
              MatchedSuffix = $suffix
            }
            break
          }
        }
      }
  }
}
$items | Sort-Object { $_.MatchedSuffix.Length } -Descending | Select-Object -First 20 | ConvertTo-Json -Depth 4
`;
  const value = await runPowerShellJson(script);
  return normalizeArray(value).map((entry) => ({
    path: entry.Path,
    bytes: entry.Length,
    lastWriteTime: entry.LastWriteTime,
    matchedSuffix: entry.MatchedSuffix
  }));
}

function resourceSuffixes(resourceUrl) {
  let path;
  try {
    const url = new URL(resourceUrl);
    path = `${url.hostname}${url.pathname}`;
  } catch {
    path = String(resourceUrl);
  }

  const normalized = path
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  const suffixes = [];
  for (let index = 0; index < normalized.length; index += 1) {
    suffixes.push(normalized.slice(index).join("/"));
  }
  return [...new Set(suffixes)];
}
$items | Sort-Object LastWriteTime -Descending | Select-Object -First 50 | ConvertTo-Json -Depth 4
`;
  const value = await runPowerShellJson(script);
  return normalizeArray(value).map((entry) => ({
    path: entry.FullName,
    bytes: entry.Length,
    lastWriteTime: entry.LastWriteTime
  }));
}

async function runPowerShellJson(script) {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 10 * 1024 * 1024
  });
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function staleLogWarnings(processes, logs) {
  const warnings = [];
  for (const process of processes) {
    if (!process.startTime) continue;
    const processStart = Date.parse(process.startTime);
    if (!Number.isFinite(processStart)) continue;
    const newerLog = logs.some((log) => {
      const lastWrite = Date.parse(log.lastWriteTime);
      return Number.isFinite(lastWrite) && lastWrite >= processStart;
    });
    if (!newerLog && logs.length > 0) {
      warnings.push(`No configured log file is newer than process ${process.name} (${process.pid}) start time.`);
    }
  }
  return warnings;
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function writeJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
