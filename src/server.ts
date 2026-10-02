/**
 * BGR Dashboard Server + Built-in Process Guard
 *
 * Uses Melina.js to serve the dashboard app with file-based routing.
 * Port ownership is never inferred from port occupancy: if an explicitly
 * requested port is busy, the dashboard moves to a fallback instead of killing
 * the listener.
 */
import path from "path";
import { getAllProcesses } from "./db";
import { isPortFree } from "./platform";

export const guardRestartCounts: Map<string, number> = new Map();
export const guardEvents: {
  time: number;
  name: string;
  action: string;
  success: boolean;
}[] = [];

const STICKY_PORT_CHECK_INTERVAL_MS = 60_000;

let originalPort = 3000;
let currentPort = 3000;

function parseRequestedPort(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

async function resolveDashboardPort(requestedPort: number): Promise<number> {
  if (process.platform !== "win32") return requestedPort;
  if (await isPortFree(requestedPort)) return requestedPort;

  // Occupancy is not ownership. Never kill an unknown listener just to reclaim
  // the dashboard's preferred port.
  return requestedPort < 65_535 ? requestedPort + 1 : requestedPort;
}

function startStickyPortChecker(): void {
  console.log(
    `[server] sticky port check ${originalPort} (current ${currentPort})`,
  );

  setInterval(async () => {
    if (currentPort === originalPort) return;

    const free = await isPortFree(originalPort);

    if (free) {
      currentPort = originalPort;
      console.log(
        `[server] preferred port ${originalPort} is available; restart dashboard to reclaim it`,
      );
    }
  }, STICKY_PORT_CHECK_INTERVAL_MS);
}

export async function startServer(): Promise<void> {
  const { start } = await import("melina");
  const appDir = path.join(import.meta.dir, "../dashboard/app");

  const explicitPort = parseRequestedPort(process.env.BUN_PORT);
  const requestedPort = explicitPort ?? 3000;
  originalPort = requestedPort;

  const resolvedPort =
    explicitPort !== null
      ? await resolveDashboardPort(requestedPort)
      : requestedPort;

  currentPort = resolvedPort;
  const needsExplicitPort =
    explicitPort !== null || currentPort !== requestedPort;

  await start({
    appDir,
    defaultTitle: "bgrun Dashboard - Process Manager",
    globalCss: path.join(appDir, "globals.css"),
    ...(needsExplicitPort && { port: currentPort }),
  });

  const { startLogRotation } = await import("./log-rotation");
  startLogRotation(() => getAllProcesses());

  if (currentPort !== requestedPort) startStickyPortChecker();
}

if (import.meta.main) {
  await startServer();
}
