import { useState } from 'react';
import { FileKey2, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
  useDeleteTrustedCa,
  useTrustedCaCertificates,
  useUploadTrustedCa,
} from '@/api/queries/certificates';

export default function TrustedCaManager({ environmentId }: { environmentId: string }) {
  const certificatesQuery = useTrustedCaCertificates(environmentId);
  const uploadMutation = useUploadTrustedCa();
  const deleteMutation = useDeleteTrustedCa();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [fileName, setFileName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const certificates = certificatesQuery.data ?? [];

  const resetUpload = () => {
    setUploadOpen(false);
    setName('');
    setPem('');
    setFileName('');
    uploadMutation.reset();
  };

  return (
    <section className="mb-6 border-y border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileKey2 className="h-5 w-5 flex-none text-gray-400" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Wi-Fi trusted CA certificates</h2>
            <p className="text-xs text-gray-500">Public server CA certificates available to enterprise Wi-Fi profiles.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="inline-flex flex-none items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus className="h-4 w-4" />
          Add CA
        </button>
      </div>

      {certificatesQuery.isLoading ? (
        <div className="border-t border-gray-100 px-4 py-4 text-sm text-gray-500">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading trusted CAs...
        </div>
      ) : certificatesQuery.isError ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {certificatesQuery.error.message || 'Failed to load trusted CA certificates.'}
        </div>
      ) : certificates.length === 0 ? (
        <div className="border-t border-gray-100 px-4 py-4 text-sm text-gray-500">No trusted CA certificates uploaded.</div>
      ) : (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {certificates.map((certificate) => (
            <div key={certificate.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{certificate.name}</p>
                <p className="truncate text-xs text-gray-500">{certificate.subject || certificate.fingerprint_sha256}</p>
                <p className="mt-0.5 text-xs text-gray-400">Expires {new Date(certificate.not_after).toLocaleDateString()}</p>
              </div>
              {deleteId === certificate.id ? (
                <div className="flex flex-none items-center gap-2">
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(
                      { id: certificate.id, environment_id: environmentId },
                      { onSuccess: () => setDeleteId(null) }
                    )}
                    className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button type="button" onClick={() => setDeleteId(null)} className="text-xs text-gray-600 hover:text-gray-900">Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.reset();
                    setDeleteId(certificate.id);
                  }}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete trusted CA"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteMutation.isError && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteMutation.error.message || 'Failed to delete trusted CA.'}
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="trusted-ca-title" className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="trusted-ca-title" className="text-base font-semibold text-gray-900">Add Wi-Fi trusted CA</h2>
              <button type="button" onClick={resetUpload} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Name</label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  placeholder="Corporate Wi-Fi root CA"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">PEM certificate</label>
                <input
                  type="file"
                  accept=".pem,.crt,text/plain,application/x-pem-file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    setFileName(file?.name ?? '');
                    setPem(file ? await file.text() : '');
                  }}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                />
                {fileName && <p className="mt-1 text-xs text-gray-500">{fileName}</p>}
              </div>
              <p className="text-xs text-gray-500">Only public CA certificates are accepted. Client certificates and private keys are not supported.</p>
              {uploadMutation.isError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {uploadMutation.error.message || 'Failed to upload trusted CA.'}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={resetUpload} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                type="button"
                disabled={!name.trim() || !pem || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate(
                  { environment_id: environmentId, name: name.trim(), cert_data: pem },
                  { onSuccess: resetUpload }
                )}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {uploadMutation.isPending ? 'Adding...' : 'Add CA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
