/** GET /api/version — return the installed bgrun version. */
import { getVersion } from "../../../lib/runtime";
import { jsonError } from "../../../lib/http";

export async function GET() {
  try {
    const version = await getVersion();
    return Response.json({ version });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
