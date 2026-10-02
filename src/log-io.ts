import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

export function readLogTail(
  path: string,
  lines?: number,
  maxBytes = 1024 * 1024,
): string {
  if (!existsSync(path)) return "";
  const size = statSync(path).size;
  if (size <= 0) return "";
  const length = Math.min(size, Math.max(1, maxBytes));
  const start = size - length;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      if (newline >= 0) text = text.slice(newline + 1);
    }
    if (lines === undefined) return text;
    if (!Number.isFinite(lines) || lines <= 0) return "";
    const parts = text.split(/(?<=\n)/);
    return parts.slice(-Math.floor(lines)).join("");
  } finally {
    closeSync(fd);
  }
}
