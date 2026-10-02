/** DELETE /api/processes/:name — stop safely and remove a managed process. */
import { deleteProcess, getProcess } from "../../../../lib/runtime";
import { jsonError } from "../../../../lib/http";

export async function DELETE(
  _req: Request,
  { params }: { params: { name: string } },
) {
  const name = decodeURIComponent(params.name);
  if (!getProcess(name)) {
    return Response.json({ error: "Process not found" }, { status: 404 });
  }

  try {
    await deleteProcess(name);
    return Response.json({ success: true });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
