import { getBlob } from './blobs.js';
import { query } from './db.js';
import {
  assertSupportedWifiCertificateReferences,
  buildOncCertificateGuid,
  collectOncServerCaRefs,
  parseServerCaCertificate,
} from './certificate-policy.js';

type CertificateRow = {
  id: string;
  blob_key: string;
};

export type OncServerCertificate = {
  GUID: string;
  Type: 'Server';
  X509: string;
};

export async function resolveOncServerCaCertificates(
  environmentId: string,
  openNetworkConfiguration: unknown
): Promise<OncServerCertificate[]> {
  assertSupportedWifiCertificateReferences(openNetworkConfiguration);
  const referencedGuids = collectOncServerCaRefs(openNetworkConfiguration);
  if (referencedGuids.length === 0) return [];

  const rows = await query<CertificateRow>(
    `SELECT id, blob_key
     FROM certificates
     WHERE environment_id = $1
       AND cert_type = 'server_ca'
       AND deleted_at IS NULL
       AND validated_at IS NOT NULL
     ORDER BY created_at ASC, id ASC`,
    [environmentId]
  );
  const rowByGuid = new Map(rows.map((row) => [buildOncCertificateGuid(row.id), row]));
  const certificates: OncServerCertificate[] = [];

  for (const guid of referencedGuids) {
    const row = rowByGuid.get(guid);
    if (!row) throw new Error(`Wi-Fi profile references unknown trusted CA: ${guid}`);
    const pem = await getBlob('certificates', row.blob_key);
    if (!pem) throw new Error(`Trusted CA blob is missing: ${guid}`);
    const parsed = parseServerCaCertificate(pem);
    certificates.push({ GUID: guid, Type: 'Server', X509: parsed.x509_base64 });
  }

  return certificates;
}
