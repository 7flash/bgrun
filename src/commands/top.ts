import { clearScreenDown, cursorTo } from "node:readline";
import {
  sampleManagedResources,
  sampleSystemResources,
  type ResourceSnapshotRow,
  type ResourceSort,
} from "../resource-monitor";

export type TopOptions = {
  once?: boolean;
  intervalMs?: number;
  system?: boolean;
  portsOnly?: boolean;
  sort?: ResourceSort;
  filter?: string;
  limit?: number;
  json?: boolean;
};

function formatMemory(bytes: number): string {
  if (!bytes) return "0MB";
  const mib = bytes / 1024 / 1024;
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}GB`;
  return `${Math.round(mib)}MB`;
}

function formatCpu(cpu: number): string {
  return `${cpu.toFixed(cpu >= 10 ? 0 : 1)}%`;
}

function guardText(row: ResourceSnapshotRow): string {
  if (!row.managed) return "-";
  if (!row.guarded) return "off";
  return row.memoryLimitMb > 0 ? `on/${Math.round(row.memoryLimitMb)}MB` : "on";
}

function truncateCommand(command: string, max = 80): string {
  const flat = command.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1))}…`;
}

export function formatTopRow(row: ResourceSnapshotRow, system = false): string {
  const ports = row.ports.length > 0 ? row.ports.join(",") : "-";
  const base = `${row.name} pid=${row.pid} cpu=${formatCpu(row.cpu)} mem=${formatMemory(row.memory)} ports=${ports} guard=${guardText(row)}`;
  if (!system) {
    return row.running
      ? base
      : `${row.name} stopped pid=${row.pid > 0 ? row.pid : "-"} guard=${guardText(row)}`;
  }
  const managed = row.managed ? "yes" : "no";
  const command = truncateCommand(row.command);
  return `${base} managed=${managed}${command ? ` cmd=${command}` : ""}`;
}

async function sample(options: TopOptions): Promise<ResourceSnapshotRow[]> {
  const shared = {
    filter: options.filter,
    portsOnly: options.portsOnly,
    sort: options.sort,
    limit: options.limit,
  };
  return options.system
    ? await sampleSystemResources(shared)
    : await sampleManagedResources(shared);
}

function render(rows: ResourceSnapshotRow[], options: TopOptions): string {
  if (options.json) return JSON.stringify(rows, null, options.once ? 2 : 0);
  if (rows.length === 0) {
    return options.portsOnly
      ? "no matching listeners"
      : "no matching processes";
  }
  return rows
    .map((row) => formatTopRow(row, Boolean(options.system)))
    .join("\n");
}

export function isInteractiveTop(
  options: TopOptions,
  stdoutIsTTY: boolean | undefined,
): boolean {
  return Boolean(stdoutIsTTY && !options.once && !options.json);
}

function drawFrame(frame: string): void {
  cursorTo(process.stdout, 0, 0);
  clearScreenDown(process.stdout);
  process.stdout.write(frame);
  if (!frame.endsWith("\n")) process.stdout.write("\n");
}

export async function showTop(options: TopOptions = {}): Promise<void> {
  const interactive = isInteractiveTop(options, process.stdout.isTTY);

  if (!interactive) {
    const rows = await sample({ ...options, once: true });
    process.stdout.write(render(rows, { ...options, once: true }));
    process.stdout.write("\n");
    return;
  }

  const intervalMs = Math.max(500, options.intervalMs || 2_000);
  let stopped = false;
  const stop = () => {
    stopped = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write("\x1b[?1049h\x1b[?25l");

  try {
    while (!stopped) {
      const rows = await sample(options);
      drawFrame(render(rows, options));
      if (!stopped) await Bun.sleep(intervalMs);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}
