import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2 } from 'lucide-react';

interface EnrollmentQrPreviewProps {
  value: string;
  size?: number;
}

export default function EnrollmentQrPreview({
  value,
  size = 240,
}: EnrollmentQrPreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setError(null);

    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!active) return;
        setDataUrl(url);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to render QR code');
      });

    return () => {
      active = false;
    };
  }, [size, value]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-surface-secondary"
        style={{ width: size, height: size }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Enrolment token QR code"
      width={size}
      height={size}
      className="rounded-lg border border-border bg-white"
    />
  );
}
