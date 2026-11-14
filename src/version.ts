import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageJson {
  name: string;
  version: string;
  description?: string;
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

export const SERVER_NAME = "maxima-mcp";
export const SERVER_TITLE = "Maxima MCP Server";

let cachedVersion: string | undefined;

/**
 * Resolve the server version once, lazily. Falls back to the npm-injected
 * version (or a constant) when `package.json` is unavailable, so a mis-packaged
 * install cannot crash startup.
 */
export function serverVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
    cachedVersion = pkg.version || process.env.npm_package_version || "0.0.0";
  } catch {
    cachedVersion = process.env.npm_package_version || "0.0.0";
  }
  return cachedVersion;
}
