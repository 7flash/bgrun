/** POST /api/stop/:name — stop through the managed lifecycle primitive. */
import {
  addHistoryEntry,
  getProcess,
  stopProcess,
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
    const result = await stopProcess(name);
    if (!result.alreadyStopped) addHistoryEntry(name, "stop", proc.pid);
    return Response.json({
      success: true,
      already_stopped: result.alreadyStopped,
      stopped_children: result.stoppedChildren,
    });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
