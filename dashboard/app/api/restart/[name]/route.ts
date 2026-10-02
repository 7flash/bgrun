/** POST /api/restart/:name — force-restart a registered process. */
import {
  addHistoryEntry,
  getProcess,
  handleRun,
} from "../../../../lib/runtime";
import { jsonError } from "../../../../lib/http";

export async function POST(
  _req: Request,
  { params }: { params: { name: string } },
) {
  const name = decodeURIComponent(params.name);
  const proc = getProcess(name);
  if (!proc) {
    return Response.json({ error: "Process not found" }, { status: 404 });
  }

  try {
    await handleRun({
      action: "run",
      name,
      force: true,
      remoteName: "",
    });

    addHistoryEntry(name, "restart", proc.pid);
    return Response.json({ success: true });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
