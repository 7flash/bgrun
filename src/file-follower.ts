import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

export type FileFollower = {
  read(): string;
  close(): void;
};

export function createFileFollower(
  path: string,
  initialOffset = 0,
): FileFollower {
  let offset = Math.max(0, initialOffset);
  let fd: number | undefined;

  const ensureOpen = (): number | undefined => {
    if (fd !== undefined) return fd;
    if (!existsSync(path)) return undefined;
    fd = openSync(path, "r");
    return fd;
  };

  return {
    read(): string {
      const handle = ensureOpen();
      if (handle === undefined) return "";
      const size = fstatSync(handle).size;
      if (size < offset) offset = 0;
      if (size <= offset) return "";
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(handle, buffer, 0, length, offset);
      offset += bytesRead;
      return buffer.subarray(0, bytesRead).toString("utf8");
    },
    close(): void {
      if (fd === undefined) return;
      closeSync(fd);
      fd = undefined;
    },
  };
}
