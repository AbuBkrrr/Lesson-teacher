import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { commonStyles, spacing, colors } from '../theme';

/**
 * Full-screen QR scanner. Calls onCode(value) once with the scanned text.
 * `accept` filters scans (return true to accept), so stray QR codes are ignored.
 */
export default function QrScanner({ visible, title, onCode, onClose, accept = () => true }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  function onScanned({ data }) {
    if (handled.current || !accept(data)) return;
    handled.current = true;
    onCode(data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => { handled.current = false; }}>
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        {!permission ? null : !permission.granted ? (
          <View style={{ padding: spacing.lg }}>
            <Text style={styles.text}>Camera access is needed to scan the code.</Text>
            <Pressable style={commonStyles.primaryButton} onPress={requestPermission}>
              <Text style={commonStyles.primaryButtonText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
        )}
        <Pressable style={[commonStyles.secondaryButton, { margin: spacing.lg }]} onPress={onClose}>
          <Text style={commonStyles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Pulls `code` out of a lessonteacher://<kind>?code=XXXX link. */
export function codeFromLink(data, kind) {
  const m = new RegExp(`^lessonteacher://${kind}\\?code=([A-Z0-9]{4,16})$`, 'i').exec(String(data || '').trim());
  return m ? m[1].toUpperCase() : null;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', padding: spacing.md },
  text: { color: '#fff', marginBottom: spacing.md, textAlign: 'center' },
  camera: { flex: 1, maxHeight: 480, marginHorizontal: spacing.md, borderRadius: 12, overflow: 'hidden', borderColor: colors.primary, borderWidth: 2 },
});
