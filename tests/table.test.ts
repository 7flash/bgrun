import { expect, test, describe } from "bun:test";
import {
  calculateColumnWidths,
  renderProcessTable,
  type ProcessTableRow,
  type TableColumn,
} from "../src/table";
import chalk from "chalk";

// Sample data for testing, includes short and very long strings.
const sampleProcesses: ProcessTableRow[] = [
  {
    id: 1,
    pid: 1234,
    name: "api-server",
    port: ":3000",
    command: "bun run start",
    workdir: "/var/www/api",
    status: chalk.green("Running"),
    runtime: "10m",
    memory: "128 MB",
  },
  {
    id: 2,
    pid: 5678,
    name: "long-process-name-that-will-certainly-be-truncated",
    port: "-",
    command: "node very-long-command-path/src/index.js --watch --verbose",
    workdir: "/home/user/dev/projects/monorepo/packages/service-worker",
    status: chalk.red("Stopped"),
    runtime: "2h",
    memory: "256 MB",
  },
];

// The column definitions used by renderProcessTable.
const sampleColumns: TableColumn[] = [
  { key: "id", header: "ID" },
  { key: "pid", header: "PID" },
  { key: "name", header: "Name" },
  { key: "port", header: "Port" },
  { key: "command", header: "Command" },
  { key: "workdir", header: "Directory" },
  { key: "status", header: "Status" },
  { key: "runtime", header: "Runtime" },
];


describe("Table Rendering Utilities", () => {

  // --- Tests for the core width calculation logic ---
  describe("calculateColumnWidths", () => {

    test("should return natural widths when content fits", () => {
      const maxWidth = 200; // Ample width
      const widths = calculateColumnWidths(sampleProcesses, sampleColumns, maxWidth);

      // The 'name' column should have its full, natural width
      const nameNaturalWidth = "long-process-name-that-will-certainly-be-truncated".length;
      expect(widths.get("name")).toBe(nameNaturalWidth);
    });

    test("should shrink columns when content overflows", () => {
      const maxWidth = 100; // Restricted width
      const widths = calculateColumnWidths(sampleProcesses, sampleColumns, maxWidth);

      const totalWidth = Array.from(widths.values()).reduce((sum, w) => sum + w, 0);

      // Natural width of the longest name
      const nameNaturalWidth = "long-process-name-that-will-certainly-be-truncated".length;

      // Check that the 'name' column was shrunk
      expect(widths.get("name")).toBeLessThan(nameNaturalWidth);
      // Check that the total width is within the allowed limit
      expect(totalWidth).toBeLessThan(maxWidth);
    });
  });

  // --- Tests for the main exported table rendering function ---
  describe("renderProcessTable", () => {

    test("should render a table without a vertical tree when width is sufficient", () => {
      // Use only short data and provide ample width
      const shortData = [sampleProcesses[0]];
      const output = renderProcessTable(shortData, { maxWidth: 150 });

      // Should contain table characters but not the vertical tree indicator
      expect(output).toContain("api-server");
      expect(output).toContain("╭"); // Horizontal table border
      expect(output).not.toContain("▶"); // Vertical tree indicator
    });

    test("should render a hybrid table with a vertical tree when truncation occurs", () => {
      const output = renderProcessTable(sampleProcesses, { maxWidth: 80 });

      // Should contain both parts of the hybrid view
      expect(output).toContain("╭"); // Horizontal table border
      expect(output).toContain("▶"); // Vertical tree indicator for truncated rows
      expect(output).toContain("…"); // Ellipsis from truncation

      // The full, untruncated name should appear in the vertical tree section
      expect(output).toContain("long-process-name-that-will-certainly-be-truncated");
    });

    test("should return a message for an empty data array", () => {
      const output = renderProcessTable([]);
      expect(output).toContain("No data to display");
    });
  });
});