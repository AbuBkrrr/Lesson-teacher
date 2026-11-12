import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders `value` as a QR code image (generated locally, nothing is sent anywhere). */
export default function QrCode({ value, size = 180, label }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [value, size]);
  if (!src) return null;
  return <span className="lt-qr"><img src={src} width={size} height={size} alt={label || 'QR code'} /></span>;
}
