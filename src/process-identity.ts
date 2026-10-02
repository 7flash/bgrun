import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function linuxBirthId(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return "";
    const fields = stat
      .slice(close + 2)
      .trim()
      .split(/\s+/);
    const startTime = fields[19];
    return startTime ? `linux:${startTime}` : "";
  } catch {
    return "";
  }
}

function windowsBirthId(pid: number): string {
  try {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\" -ErrorAction SilentlyContinue).CreationDate`;
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 3000 },
    ).trim();
    return output ? `windows:${output}` : "";
  } catch {
    return "";
  }
}

function unixBirthId(pid: number): string {
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return output ? `unix:${output.replace(/\s+/g, " ")}` : "";
  } catch {
    return "";
  }
}

export function getProcessBirthId(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) return "";
  if (process.platform === "win32") return windowsBirthId(pid);
  if (process.platform === "linux")
    return linuxBirthId(pid) || unixBirthId(pid);
  return unixBirthId(pid);
}
