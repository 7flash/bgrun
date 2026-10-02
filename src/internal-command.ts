export function resolveInternalBgrunCommand(command: string): string {
  const trimmed = command.trim();
  if (/^bgrun\s+--_(?:serve|watch-process)(?:\s|$)/i.test(trimmed)) {
    return `bunx ${trimmed}`;
  }
  if (/^bgr\s+--_(?:serve|watch-process)(?:\s|$)/i.test(trimmed)) {
    return `bunx bgrun${trimmed.slice(3)}`;
  }
  return command;
}
