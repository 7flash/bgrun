/** GET /api/debug — diagnostic information about the current bgrun runtime. */
import { getDbInfo } from "../../../lib/runtime";

export async function GET() {
  const info = getDbInfo();

  return Response.json({
    ...info,
    platform: process.platform,
    bun: Bun.version,
    pid: process.pid,
    cwd: process.cwd(),
  });
}
