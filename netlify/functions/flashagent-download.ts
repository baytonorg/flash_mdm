import type { Context } from "@netlify/functions";
import { requireAuth } from "./_lib/auth.js";
import { requireEnvironmentAccessScopeForResourcePermission } from "./_lib/rbac.js";
import { queryOne } from "./_lib/db.js";
import { getBlob } from "./_lib/blobs.js";
import { getSearchParams, errorResponse } from "./_lib/helpers.js";
import { sanitizeErrorForLog } from "./_lib/log-safety.js";

function normalizeFilename(input: string | null, fallbackId: string): string {
  const fallback = `flashi-export-${fallbackId}.csv`;
  if (!input) return fallback;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  if (!cleaned) return fallback;
  return cleaned.endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const auth = await requireAuth(request);
    const params = getSearchParams(request);

    const exportId = params.get("id")?.trim() ?? "";
    const environmentId = params.get("environment_id")?.trim() ?? "";
    if (!isUuid(exportId) || !isUuid(environmentId)) {
      return errorResponse("id and environment_id must be valid UUIDs", 400);
    }

    const env = await queryOne<{ workspace_id: string }>(
      "SELECT workspace_id FROM environments WHERE id = $1",
      [environmentId],
    );
    if (!env) return errorResponse("Access denied", 403);

    await requireEnvironmentAccessScopeForResourcePermission(
      auth,
      environmentId,
      "flashagent",
      "read",
    );

    const key = `flashagent/${env.workspace_id}/${environmentId}/${exportId}.csv`;
    const content = await getBlob("exports", key);
    if (content == null) {
      return errorResponse("Export not found", 404);
    }

    const filename = normalizeFilename(params.get("filename"), exportId);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("Flashi download error:", sanitizeErrorForLog(err));
    return errorResponse("Internal server error", 500);
  }
}
