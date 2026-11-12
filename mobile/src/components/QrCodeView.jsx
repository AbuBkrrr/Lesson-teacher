import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import QRCode from 'qrcode';

/** Draws `value` as a QR code (generated on the device). */
export default function QrCodeView({ value, size = 180, label }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    return { path: d, count: n };
  }, [value]);
  const quiet = 2;
  const vb = count + quiet * 2;
  return (
    <View accessible accessibilityLabel={label || 'QR code'} style={{ alignSelf: 'center', backgroundColor: '#fff', padding: 8, borderRadius: 8 }}>
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${vb} ${vb}`}>
        <Rect x={-quiet} y={-quiet} width={vb} height={vb} fill="#fff" />
        <Path d={path} fill="#000" />
      </Svg>
    </View>
  );
}
