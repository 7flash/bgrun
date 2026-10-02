import { error, announce } from "../logger";
import { getProcess } from "../db";
import {
  calculateRuntime,
  parseEnvString,
  isInternalProcessName,
} from "../utils";
import { inspectManagedProcessSnapshot } from "../process-snapshot";
import chalk from "chalk";

export async function showDetails(name: string) {
  const proc = getProcess(name);
  if (!proc) {
    error(`No process found named '${name}'`);
    return;
  }
  if (isInternalProcessName(proc.name)) {
    error(`'${name}' is an internal bgrun process.`);
    return;
  }

  const snapshot = await inspectManagedProcessSnapshot(proc);
  const isRunning = snapshot.state === "running";
  const runtime = isRunning ? calculateRuntime(proc.timestamp) : "-";
  const envVars = parseEnvString(proc.env);
  const ports = snapshot.ports;
  const displayPid = snapshot.pid ?? proc.pid;

  const portDisplay =
    ports.length > 0
      ? ports.map((p) => chalk.hex("#FF6B6B")(`:${p}`)).join(", ")
      : null;

  const details = `
${chalk.bold("Process Details:")}
${chalk.gray("═".repeat(50))}
${chalk.cyan.bold("Name:")} ${proc.name}
${chalk.yellow.bold("PID:")} ${isRunning ? displayPid : "-"}${portDisplay ? `\n${chalk.hex("#FF6B6B").bold("Port:")} ${portDisplay}` : ""}
${chalk.bold("Status:")} ${isRunning ? chalk.green.bold("● Running") : chalk.red.bold("○ Stopped")}
${chalk.magenta.bold("Runtime:")} ${runtime}
${chalk.blue.bold("Working Directory:")} ${proc.workdir}
${chalk.white.bold("Command:")} ${proc.command}
${chalk.cyan.bold("Parent:")} ${envVars.BGR_PARENT_NAME || envVars.BGRUN_PARENT_NAME || "-"}
${chalk.gray.bold("Config Path:")} ${proc.configPath}
${chalk.green.bold("Stdout Path:")} ${proc.stdout_path}
${chalk.red.bold("Stderr Path:")} ${proc.stderr_path}

${chalk.bold("🔧 Environment Variables:")}
${chalk.gray("═".repeat(50))}
${Object.entries(envVars)
  .map(([key, value]) => `${chalk.cyan.bold(key)} = ${chalk.yellow(value)}`)
  .join("\n")}
`;
  announce(details, `Process Details: ${name}`);
}
