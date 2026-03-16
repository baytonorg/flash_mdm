import type { Context } from '@netlify/functions';
import { createHash } from 'crypto';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { storeBlob, deleteBlob } from './_lib/blobs.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';
import { getPolicyAmapiContext, syncPolicyDerivativesForPolicy } from './_lib/policy-derivatives.js';

/**
 * Parse a PEM certificate and extract key details.
 * Uses basic ASN.1 parsing for fingerprint and validity extraction.
 */
function parseCertificate(pemData: string): {
  fingerprint_sha256: string;
  not_after: string | null;
  subject: string | null;
  issuer_name: string | null;
} {
  // Remove PEM headers and decode
  const b64 = pemData
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const derBuffer = Buffer.from(b64, 'base64');

  // SHA-256 fingerprint of the DER-encoded certificate
  const fingerprint = createHash('sha256').update(derBuffer).digest('hex');
  const formattedFingerprint = fingerprint
    .toUpperCase()
    .match(/.{2}/g)
    ?.join(':') ?? fingerprint.toUpperCase();

  // Basic extraction: we parse what we can, but full X.509 parsing
  // would require a dedicated library. Return fingerprint as the key identifier.
  return {
    fingerprint_sha256: formattedFingerprint,
    not_after: null, // Would need ASN.1 parser for accurate extraction
    subject: null,
    issuer_name: null,
  };
}

/**
 * Validate that the input looks like a PEM certificate.
 */
function isValidPem(data: string): boolean {
  return data.includes('-----BEGIN CERTIFICATE-----') && data.includes('-----END CERTIFICATE-----');
}

async function syncEnvironmentPoliciesAfterCertificateChange(environmentId: string): Promise<void> {
  const amapiContext = await getPolicyAmapiContext(environmentId);
  if (!amapiContext) return;

  const policies = await query<{ id: string; config: Record<string, unknown> | string | null }>(
    'SELECT id, config FROM policies WHERE environment_id = $1',
    [environmentId]
  );

  for (const policy of policies) {
    try {
      const baseConfig = typeof policy.config === 'string'
        ? JSON.parse(policy.config)
        : (policy.config ?? {});
      await syncPolicyDerivativesForPolicy({
        policyId: policy.id,
        environmentId,
        baseConfig,
        amapiContext,
      });
    } catch (err) {
      console.warn('certificate-crud: derivative sync skipped/failed after certificate change', {
        environment_id: environmentId,
        policy_id: policy.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const normalizedPath = url.pathname
      .replace(/^\/api\/certificates\/?/, '')
      .replace(/^\/\.netlify\/functions\/certificate-crud\/?/, '');
    const segments = normalizedPath.split('/').filter(Boolean);
    const action = segments[0]; // list, upload, or :id

    // GET /api/certificates/list?environment_id=...
    if (request.method === 'GET' && action === 'list') {
      const params = getSearchParams(request);
      const environmentId = params.get('environment_id');
      if (!environmentId) return errorResponse('environment_id is required');

      await requireEnvironmentResourcePermission(auth, environmentId, 'certificate', 'read');

      let certificates: unknown[];
      try {
        certificates = await query(
          `SELECT id, environment_id, name, cert_type, fingerprint_sha256, not_after,
                subject, issuer_name, uploaded_by, created_at
           FROM certificates
           WHERE environment_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC`,
          [environmentId]
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const missingCompatColumns =
          message.includes('column "subject" does not exist')
          || message.includes('column "issuer_name" does not exist')
          || message.includes('column "uploaded_by" does not exist');
        if (!missingCompatColumns) throw err;

        console.warn('certificate-crud: legacy certificates schema detected; using compatibility list query');
        try {
          certificates = await query(
            `SELECT id, environment_id, name, cert_type, fingerprint_sha256, not_after,
                  NULL::text AS subject,
                  NULL::text AS issuer_name,
                  NULL::uuid AS uploaded_by,
                  created_at
             FROM certificates
             WHERE environment_id = $1 AND deleted_at IS NULL
             ORDER BY created_at DESC`,
            [environmentId]
          );
        } catch (compatErr) {
          const compatMessage = compatErr instanceof Error ? compatErr.message : String(compatErr);
          if (!compatMessage.includes('column "deleted_at" does not exist')) throw compatErr;

          console.warn('certificate-crud: certificates.deleted_at missing; using legacy soft-delete compatibility query');
          certificates = await query(
            `SELECT id, environment_id, name, cert_type, fingerprint_sha256, not_after,
                  NULL::text AS subject,
                  NULL::text AS issuer_name,
                  NULL::uuid AS uploaded_by,
                  created_at
             FROM certificates
             WHERE environment_id = $1
             ORDER BY created_at DESC`,
            [environmentId]
          );
        }
      }

      return jsonResponse({ certificates });
    }

    // POST /api/certificates/upload
    if (request.method === 'POST' && action === 'upload') {
      const body = await parseJsonBody<{
      environment_id: string;
      name: string;
      cert_type?: string;
      cert_data: string; // base64 or PEM
      not_after?: string; // optional manual override
    }>(request);

      if (!body.environment_id || !body.name || !body.cert_data) {
        return errorResponse('environment_id, name, and cert_data are required');
      }

      await requireEnvironmentResourcePermission(auth, body.environment_id, 'certificate', 'write');

    // Determine if the cert_data is base64-encoded or raw PEM
      let pemData: string;
      if (isValidPem(body.cert_data)) {
        pemData = body.cert_data;
      } else {
      // Try to decode as base64
        try {
          pemData = Buffer.from(body.cert_data, 'base64').toString('utf-8');
          if (!isValidPem(pemData)) {
            return errorResponse('Invalid certificate data. Expected PEM format.');
          }
        } catch {
          return errorResponse('Invalid certificate data. Expected PEM or base64-encoded PEM.');
        }
      }
    // Parse certificate
      const certInfo = parseCertificate(pemData);

    // Check for duplicate fingerprint in this environment
      const duplicate = await queryOne(
        `SELECT id FROM certificates
         WHERE environment_id = $1 AND fingerprint_sha256 = $2 AND deleted_at IS NULL`,
        [body.environment_id, certInfo.fingerprint_sha256]
      );
      if (duplicate) {
        return errorResponse('A certificate with this fingerprint already exists in this environment');
      }

      const certId = crypto.randomUUID();
      const blobKey = `${body.environment_id}/${certId}.pem`;

    // Store the PEM file in Netlify Blobs
      await storeBlob('certificates', blobKey, pemData, {
        environment_id: body.environment_id,
        cert_id: certId,
        fingerprint: certInfo.fingerprint_sha256,
      });

    // Insert into certificates table
      await execute(
        `INSERT INTO certificates (id, environment_id, name, cert_type, fingerprint_sha256, not_after, subject, issuer_name, uploaded_by, blob_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          certId,
          body.environment_id,
          body.name,
          body.cert_type ?? 'ca',
          certInfo.fingerprint_sha256,
          body.not_after ?? certInfo.not_after,
          certInfo.subject,
          certInfo.issuer_name,
          auth.user.id,
          blobKey,
        ]
      );

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'certificate.uploaded',
        resource_type: 'certificate',
        resource_id: certId,
        details: {
          name: body.name,
          cert_type: body.cert_type ?? 'ca',
          fingerprint: certInfo.fingerprint_sha256,
        },
        ip_address: getClientIp(request),
      });

      await syncEnvironmentPoliciesAfterCertificateChange(body.environment_id);

      return jsonResponse({
        certificate: {
          id: certId,
          name: body.name,
          cert_type: body.cert_type ?? 'ca',
          fingerprint_sha256: certInfo.fingerprint_sha256,
          not_after: body.not_after ?? certInfo.not_after,
        },
      }, 201);
    }

    // DELETE /api/certificates/:id
    if (request.method === 'DELETE' && action && action !== 'list' && action !== 'upload') {
      const certId = action;

      const cert = await queryOne<{ id: string; environment_id: string; blob_key: string; name: string }>(
        'SELECT id, environment_id, blob_key, name FROM certificates WHERE id = $1 AND deleted_at IS NULL',
        [certId]
      );

      if (!cert) return errorResponse('Certificate not found', 404);

      await requireEnvironmentResourcePermission(auth, cert.environment_id, 'certificate', 'delete');

    // Soft-delete in DB
      await execute(
        'UPDATE certificates SET deleted_at = now() WHERE id = $1',
        [certId]
      );

    // Delete from Blobs
      try {
        await deleteBlob('certificates', cert.blob_key);
      } catch (err) {
        console.error('Failed to delete certificate blob:', err);
      }

      await logAudit({
        environment_id: cert.environment_id,
        user_id: auth.user.id,
        action: 'certificate.deleted',
        resource_type: 'certificate',
        resource_id: certId,
        details: { name: cert.name },
        ip_address: getClientIp(request),
      });

      await syncEnvironmentPoliciesAfterCertificateChange(cert.environment_id);

      return jsonResponse({ message: 'Certificate deleted' });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('certificate-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
