/**
 * Shared workspace credential resolution.
 * Decrypts Google service account credentials and mints an access token.
 */

import { queryOne } from "./db.js";

export interface WorkspaceCredentials {
  accessToken: string;
  projectId: string;
}

/**
 * Resolve a Google access token and GCP project ID for a workspace.
 * Throws descriptive errors if credentials are missing or invalid.
 */
export async function resolveAccessTokenAndProject(
  workspaceId: string,
): Promise<WorkspaceCredentials> {
  const { decrypt } = await import("./crypto.js");
  const { GoogleAuth } = await import("google-auth-library");

  const workspace = await queryOne<{
    google_credentials_enc: string;
    gcp_project_id: string;
  }>(
    "SELECT google_credentials_enc, gcp_project_id FROM workspaces WHERE id = $1",
    [workspaceId],
  );

  if (!workspace?.google_credentials_enc) {
    throw new Error("No Google credentials configured for this workspace.");
  }

  let credentialsJson: string;
  try {
    credentialsJson = decrypt(
      workspace.google_credentials_enc,
      `workspace:${workspaceId}`,
    );
  } catch (err) {
    console.error(
      "Credential decryption failed:",
      err instanceof Error ? err.message : String(err),
    );
    throw new Error(
      "Failed to decrypt workspace credentials. Please re-upload your service account JSON.",
    );
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(credentialsJson);
  } catch {
    throw new Error(
      "Malformed workspace credentials. Please re-upload service account JSON.",
    );
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidmanagement"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error("Failed to obtain access token from Google.");
  }

  return {
    accessToken: tokenResponse.token,
    projectId:
      workspace.gcp_project_id || (credentials.project_id as string) || "",
  };
}
