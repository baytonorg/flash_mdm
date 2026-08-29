import type { Context } from '@netlify/functions';
import { query, queryOne, transaction } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentResourcePermission } from './_lib/rbac.js';
import { logAudit } from './_lib/audit.js';
import { storeBlob, deleteBlob } from './_lib/blobs.js';
import { jsonResponse, errorResponse, parseJsonBody, getSearchParams, getClientIp } from './_lib/helpers.js';
import { buildOncCertificateGuid, collectOncServerCaRefs, parseServerCaCertificate } from './_lib/certificate-policy.js';

export default async (request: Request, _context: Context) => {
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

      const certificates = await query<Record<string, unknown> & { id: string }>(
        `SELECT id, environment_id, name, cert_type, fingerprint_sha256, not_after,
                subject, issuer_name, uploaded_by, scope_type, scope_id, created_at
         FROM certificates
         WHERE environment_id = $1
           AND deleted_at IS NULL
           AND validated_at IS NOT NULL
         ORDER BY created_at DESC`,
        [environmentId]
      );

      return jsonResponse({
        certificates: certificates.map((certificate) => ({
          ...certificate,
          onc_guid: buildOncCertificateGuid(certificate.id),
        })),
      });
    }

    // POST /api/certificates/upload
    if (request.method === 'POST' && action === 'upload') {
      const body = await parseJsonBody<{
        environment_id: string;
        name: string;
        cert_data: string; // base64 or PEM
      }>(request);

      if (!body.environment_id || !body.name || !body.cert_data) {
        return errorResponse('environment_id, name, and cert_data are required');
      }
      const certificateName = body.name.trim();
      if (!certificateName) return errorResponse('name must not be blank');

      await requireEnvironmentResourcePermission(auth, body.environment_id, 'certificate', 'write');

      let certInfo;
      try {
        certInfo = parseServerCaCertificate(body.cert_data);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid certificate data', 400);
      }

      // Check for duplicate fingerprint in this environment
      const duplicate = await queryOne(
         `SELECT id FROM certificates
         WHERE environment_id = $1
           AND fingerprint_sha256 = $2
           AND deleted_at IS NULL
           AND validated_at IS NOT NULL`,
        [body.environment_id, certInfo.fingerprint_sha256]
      );
      if (duplicate) {
        return errorResponse('A certificate with this fingerprint already exists in this environment', 409);
      }

      const certId = crypto.randomUUID();
      const blobKey = `${body.environment_id}/${certId}.pem`;

      // Store the PEM file in the runtime's configured blob store.
      await storeBlob('certificates', blobKey, certInfo.pem, {
        environment_id: body.environment_id,
        cert_id: certId,
        fingerprint: certInfo.fingerprint_sha256,
      });

      try {
        await transaction(async (client) => {
          await client.query(
            `INSERT INTO certificates (
               id, environment_id, name, cert_type, fingerprint_sha256, not_after,
               subject, issuer_name, uploaded_by, validated_at, blob_key, scope_type, scope_id
             )
             VALUES ($1, $2, $3, 'server_ca', $4, $5, $6, $7, $8, now(), $9, 'environment', $2)`,
            [
              certId,
              body.environment_id,
              certificateName,
              certInfo.fingerprint_sha256,
              certInfo.not_after,
              certInfo.subject,
              certInfo.issuer_name,
              auth.user.id,
              blobKey,
            ]
          );
        });
      } catch (err) {
        await deleteBlob('certificates', blobKey).catch(() => undefined);
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
          return errorResponse('A certificate with this fingerprint already exists in this environment', 409);
        }
        throw err;
      }

      await logAudit({
        environment_id: body.environment_id,
        user_id: auth.user.id,
        action: 'certificate.uploaded',
        resource_type: 'certificate',
        resource_id: certId,
        details: {
          name: certificateName,
          cert_type: 'server_ca',
          fingerprint: certInfo.fingerprint_sha256,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        certificate: {
          id: certId,
          name: certificateName,
          cert_type: 'server_ca',
          onc_guid: buildOncCertificateGuid(certId),
          fingerprint_sha256: certInfo.fingerprint_sha256,
          not_after: certInfo.not_after,
          subject: certInfo.subject,
          issuer_name: certInfo.issuer_name,
        },
        message: 'Trusted CA stored. Select it in an enterprise Wi-Fi profile to deploy it.',
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

      const oncGuid = buildOncCertificateGuid(cert.id);
      const deployments = await query<{ id: string; name: string; onc_profile: Record<string, unknown> | string }>(
        `SELECT id, name, onc_profile
         FROM network_deployments
         WHERE environment_id = $1 AND network_type = 'wifi'`,
        [cert.environment_id]
      );
      const references = deployments.filter((deployment) => {
        const profile = typeof deployment.onc_profile === 'string'
          ? JSON.parse(deployment.onc_profile)
          : deployment.onc_profile;
        return collectOncServerCaRefs(profile).includes(oncGuid);
      });
      if (references.length > 0) {
        return jsonResponse({
          error: 'Certificate is referenced by one or more Wi-Fi profiles',
          references: references.map(({ id, name }) => ({ id, name })),
        }, 409);
      }

      await transaction(async (client) => {
        await client.query('UPDATE certificates SET deleted_at = now() WHERE id = $1', [certId]);
      });

      // Delete from the runtime's configured blob store.
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

      return jsonResponse({ message: 'Certificate deleted' });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('certificate-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
