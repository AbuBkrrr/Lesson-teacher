import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Share, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { deviceLink, conversations } from '../api/client';
import { clearCache } from '../utils/offline';
import { confirmAction } from '../utils/confirm';
import { colors, spacing, typography, commonStyles } from '../theme';
import QrScanner, { codeFromLink } from '../components/QrScanner';

export default function LinkedDevicesScreen() {
  const [devices, setDevices] = useState([]);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    deviceLink.devices().then((d) => setDevices(d.devices)).catch((e) => setErr(e.message));
  }, []);
  useFocusEffect(load);

  function approve(value = code) {
    setErr(null); setMsg(null);
    deviceLink.approve(value).then((r) => { setMsg(`Linked ${r.label || 'device'}.`); setCode(''); load(); }).catch((e) => setErr(e.message));
  }
  function revoke(d) {
    confirmAction(`Sign out ${d.label}?`, 'It will need to sign in again.', () => deviceLink.revoke(d.id).then(load).catch((e) => setErr(e.message)), 'Sign out');
  }
  function backup() {
    setErr(null);
    conversations.exportChats()
      .then((data) => Share.share({ title: 'Lesson Teacher chat backup', message: JSON.stringify(data, null, 2) }))
      .catch((e) => setErr(e.message));
  }
  function clearLocal() {
    confirmAction('Clear offline data?', 'Unsent messages on this device will be lost; everything else re-downloads when you are online.', () => clearCache().then(() => setMsg('Offline data cleared.')), 'Clear');
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent} keyboardShouldPersistTaps="handled">
      {err && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{err}</Text></View>}
      {msg && <Text style={styles.ok}>{msg}</Text>}

      <Text style={styles.h}>Linked devices</Text>
      <Text style={styles.help}>To use Lesson Teacher on a computer, open the desktop app, choose “Sign in with a code”, then scan its QR code here (or type the code).</Text>
      {devices.map((d) => (
        <View key={d.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{d.label}{d.current ? ' (this device)' : ''}</Text>
            <Text style={styles.help}>Last active {new Date(d.last_used_at || d.created_at).toLocaleString()}</Text>
          </View>
          {!d.current && <Pressable onPress={() => revoke(d)}><Text style={styles.link}>Sign out</Text></Pressable>}
        </View>
      ))}
      <TextInput style={styles.input} value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Code from the new device" autoCapitalize="characters" maxLength={8} />
      <Pressable style={[commonStyles.primaryButton, code.length < 8 && commonStyles.buttonDisabled]} disabled={code.length < 8} onPress={() => approve()}>
        <Text style={commonStyles.primaryButtonText}>Link device</Text>
      </Pressable>
      <Pressable style={[commonStyles.secondaryButton, { marginTop: spacing.sm }]} onPress={() => setScanning(true)}>
        <Text style={commonStyles.secondaryButtonText}>Scan QR code from computer</Text>
      </Pressable>
      <QrScanner
        visible={scanning}
        title="Scan the QR code shown on the Lesson Teacher desktop app"
        accept={(d) => !!codeFromLink(d, 'link')}
        onClose={() => setScanning(false)}
        onCode={(d) => { setScanning(false); const c = codeFromLink(d, 'link'); setCode(c); approve(c); }}
      />

      <Text style={[styles.h, { marginTop: spacing.lg }]}>Chat backup &amp; storage</Text>
      <Text style={styles.help}>Your messages are kept on our servers and re-sync to any device you sign in on. You can also keep your own copy.</Text>
      <Pressable style={commonStyles.primaryButton} onPress={backup}><Text style={commonStyles.primaryButtonText}>Back up my chats</Text></Pressable>
      <Pressable style={{ marginTop: spacing.sm }} onPress={clearLocal}><Text style={styles.link}>Clear offline data on this device</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ok: { color: colors.primary, fontWeight: '700', marginBottom: spacing.sm },
  h: { fontSize: typography.h2 || 18, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  name: { fontSize: typography.body, color: colors.text, fontWeight: '600' },
  link: { color: colors.primary, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.sm, marginVertical: spacing.sm, backgroundColor: colors.card },
});
