/** POST /api/start — create or start a process. */
import { addHistoryEntry, handleRun } from "../../../lib/runtime";
import {
  jsonError,
  readJsonObject,
  readOptionalString,
  readRequiredString,
  readStringRecord,
} from "../../../lib/http";

export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    const name = readRequiredString(body.name, "name");
    const env = readStringRecord(body.env, "env");

    await handleRun({
      action: "run",
      name,
      command: readOptionalString(body.command),
      directory: readOptionalString(body.directory),
      force: body.force === true,
      env,
      remoteName: "",
    });

    addHistoryEntry(name, "start");
    return Response.json({ success: true });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
