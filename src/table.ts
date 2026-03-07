#!/usr/bin/env bun

import chalk from "chalk";

export interface TableColumn {
  key: string;
  header: string;
  formatter?: (value: any) => string;
  truncator?: (value: string, maxLength: number) => string;
}

export interface TableOptions {
  maxWidth?: number;
  padding?: number;
  borderStyle?: "rounded" | "single" | "double" | "none";
  showHeaders?: boolean;
}

export interface ProcessTableRow {
  id: number;
  pid: number;
  name: string;
  port: string;
  memory: string;
  command: string;
  workdir: string;
  status: string;
  runtime: string;
}

// Get terminal width or use default
export function getTerminalWidth(): number {
  return process.stdout.columns || 120;
}

// Strip ANSI color codes for accurate length calculation
export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

// Default truncator: trims the end of a string
export function truncateString(str: string, maxLength: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxLength) return str;
  const ellipsis = "…";
  // Ensure maxLength is at least 1 for the ellipsis
  if (maxLength < 1) return "";
  if (maxLength === 1) return ellipsis;

  const targetLength = maxLength - ellipsis.length;
  return str.substring(0, targetLength > 0 ? targetLength : 0) + ellipsis;
}

// Path truncator: trims the middle of a string
export function truncatePath(str: string, maxLength: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxLength) return str;
  const ellipsis = "…";
  // Ensure maxLength is at least 3 for a start, middle, and end character
  if (maxLength < 3) return truncateString(str, maxLength);

  const targetLength = maxLength - ellipsis.length;
  const startLen = Math.ceil(targetLength / 2);
  const endLen = Math.floor(targetLength / 2);
  return str.substring(0, startLen) + ellipsis + str.substring(str.length - endLen);
}

// Calculate column widths by proportionally shrinking the widest columns
export function calculateColumnWidths(
  rows: any[],
  columns: TableColumn[],
  maxWidth: number,
  padding: number = 2
): Map<string, number> {
  const separatorsWidth = columns.length + 1;
  const paddingWidth = padding * columns.length;
  const availableWidth = maxWidth - separatorsWidth - paddingWidth;

  const naturalWidths = new Map<string, number>();

  // 1. Calculate the natural width (max content length) for each column
  for (const col of columns) {
    let maxNatural = stripAnsi(col.header).length;
    for (const row of rows) {
      const value = col.formatter ? col.formatter(row[col.key]) : String(row[col.key] || "");
      maxNatural = Math.max(maxNatural, stripAnsi(value).length);
    }
    naturalWidths.set(col.key, maxNatural);
  }

  const totalNaturalWidth = Array.from(naturalWidths.values()).reduce((sum, w) => sum + w, 0);

  // 2. If it fits, we're done
  if (totalNaturalWidth <= availableWidth) {
    return naturalWidths;
  }

  // 3. If not, calculate the overage and shrink the widest columns iteratively
  let overage = totalNaturalWidth - availableWidth;
  const currentWidths = new Map(naturalWidths);

  while (overage > 0) {
    // Find the column that is currently the widest
    let widestColKey: string | null = null;
    let maxW = -1;
    for (const [key, width] of currentWidths.entries()) {
      if (width > maxW) {
        maxW = width;
        widestColKey = key;
      }
    }

    // If no column can be shrunk (e.g., all are width 0), break
    if (widestColKey === null || maxW <= 1) {
      break;
    }

    // Shrink the widest column by 1
    currentWidths.set(widestColKey, maxW - 1);
    overage--;
  }

  return currentWidths;
}

function renderBorder(widths: number[], padding: number, style: string[]): string {
  const [left, mid, right, line] = style;
  let lineStr = left;
  for (let i = 0; i < widths.length; i++) {
    lineStr += line.repeat(widths[i] + padding);
    if (i < widths.length - 1) {
      lineStr += mid;
    }
  }
  lineStr += right;
  return lineStr;
}

export function renderHorizontalTable(
  rows: any[],
  columns: TableColumn[],
  options: TableOptions = {}
): { table: string; truncatedIndices: number[] } {
  const { maxWidth = getTerminalWidth(), padding = 2, borderStyle = "rounded", showHeaders = true } = options;
  if (rows.length === 0) return { table: chalk.gray("No data to display"), truncatedIndices: [] };

  const borderChars: Record<string, string[]> = {
    rounded: ["╭", "┬", "╮", "─", "│", "├", "┼", "┤", "╰", "┴", "╯"],
    single: ["┌", "┬", "┐", "─", "│", "├", "┼", "┤", "└", "┴", "┘"],
    double: ["╔", "╦", "╗", "═", "║", "╠", "╬", "╣", "╚", "╩", "╝"],
    none: [" ", " ", " ", " ", " ", " ", " ", " ", " ", " ", " "],
  };
  const [tl, tc, tr, h, v, ml, mc, mr, bl, bc, br] = borderChars[borderStyle] ?? borderChars.rounded;
  const columnWidths = calculateColumnWidths(rows, columns, maxWidth, padding);
  const widthArray = columns.map((col) => columnWidths.get(col.key)!);
  const truncatedIndices = new Set<number>();
  const lines: string[] = [];
  const cellPadding = " ".repeat(padding / 2);

  if (borderStyle !== "none") lines.push(renderBorder(widthArray, padding, [tl, tc, tr, h]));

  if (showHeaders) {
    const headerCells = columns.map((col, i) => chalk.bold(truncateString(col.header, widthArray[i]).padEnd(widthArray[i])));
    lines.push(`${v}${cellPadding}${headerCells.join(`${cellPadding}${v}${cellPadding}`)}${cellPadding}${v}`);
    if (borderStyle !== "none") lines.push(renderBorder(widthArray, padding, [ml, mc, mr, h]));
  }

  rows.forEach((row, rowIndex) => {
    const cells = columns.map((col, i) => {
      const width = widthArray[i];
      const originalValue = col.formatter ? col.formatter(row[col.key]) : String(row[col.key] || "");
      if (stripAnsi(originalValue).length > width) {
        truncatedIndices.add(rowIndex);
      }
      const truncator = col.truncator || truncateString;
      const truncated = truncator(originalValue, width);
      return truncated + " ".repeat(Math.max(0, width - stripAnsi(truncated).length));
    });
    lines.push(`${v}${cellPadding}${cells.join(`${cellPadding}${v}${cellPadding}`)}${cellPadding}${v}`);
  });

  if (borderStyle !== "none") lines.push(renderBorder(widthArray, padding, [bl, bc, br, h]));

  return { table: lines.join("\n"), truncatedIndices: Array.from(truncatedIndices) };
}

export function renderVerticalTree(rows: any[], columns: TableColumn[]): string {
  const lines: string[] = [];
  rows.forEach((row, index) => {
    if (index > 0) lines.push("");
    const name = row.name ? `'${row.name}'` : `(ID: ${row.id})`;
    lines.push(chalk.cyan(`▶ ${name}`));

    columns.forEach((col) => {
      const value = col.formatter ? col.formatter(row[col.key]) : String(row[col.key] || "");
      lines.push(`  ├─ ${chalk.gray(`${col.header}:`)} ${value}`);
    });
  });
  return lines.join("\n");
}

export function renderHybridTable(
  rows: any[],
  columns: TableColumn[],
  options: TableOptions = {}
): string {
  const { table, truncatedIndices } = renderHorizontalTable(rows, columns, options);
  const output = [table];

  if (truncatedIndices.length > 0) {
    const truncatedRows = truncatedIndices.map((i) => rows[i]);
    output.push("\n" + renderVerticalTree(truncatedRows, columns));
  }

  return output.join("\n");
}

export function renderProcessTable(processes: ProcessTableRow[], options?: TableOptions): string {
  const columns: TableColumn[] = [
    { key: "id", header: "ID", formatter: (id) => chalk.blue(id) },
    { key: "pid", header: "PID", formatter: (pid) => chalk.yellow(pid) },
    { key: "name", header: "Name", formatter: (name) => chalk.cyan.bold(name) },
    { key: "port", header: "Port", formatter: (port) => port === '-' ? chalk.gray(port) : chalk.hex('#FF6B6B')(port) },
    { key: "memory", header: "Memory", formatter: (mem) => mem === '-' ? chalk.gray(mem) : chalk.hex('#4ECDC4')(mem) },
    { key: "command", header: "Command" },
    { key: "workdir", header: "Directory", formatter: (dir) => chalk.gray(dir), truncator: truncatePath },
    { key: "status", header: "Status" },
    { key: "runtime", header: "Runtime", formatter: (runtime) => chalk.magenta(runtime) },
  ];

  return renderHybridTable(processes, columns, options);
}