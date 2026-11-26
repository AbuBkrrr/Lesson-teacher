import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import QrScanner, { codeFromLink } from '../components/QrScanner';
import { colors, spacing, commonStyles } from '../theme';

/** A child signs up with the one-time code (or QR code) from their parent. */
export default function ChildInviteScreen({ navigation }) {
  const { redeemInvite } = useAuth();
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    if (!code.trim() || !username.trim() || password.length < 8) {
      setError('Enter the code, a username, and a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await redeemInvite(code.trim(), username.trim(), password);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={commonStyles.screen} contentContainerStyle={[commonStyles.screenContent, { paddingTop: spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>I have a code</Text>
        <Text style={{ color: colors.muted, marginVertical: spacing.sm }}>
          Ask your parent to open My children and create a login code for you. Do this together.
        </Text>
        {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

        <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.md }]} onPress={() => setScanning(true)}>
          <Text style={commonStyles.secondaryButtonText}>Scan the QR code on your parent&apos;s screen</Text>
        </Pressable>

        <Text style={commonStyles.label}>Code from your parent</Text>
        <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} value={code} onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters" placeholder="e.g. AB12CD" accessibilityLabel="Code from your parent" />
        <Text style={commonStyles.label}>Pick a username</Text>
        <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} value={username} onChangeText={setUsername}
          autoCapitalize="none" autoCorrect={false} accessibilityLabel="Username" />
        <Text style={commonStyles.label}>Pick a password (8+ characters)</Text>
        <TextInput style={[commonStyles.input, { marginBottom: spacing.md }]} value={password} onChangeText={setPassword}
          secureTextEntry accessibilityLabel="Password" />

        <Pressable style={[commonStyles.primaryButton, busy && commonStyles.buttonDisabled]} disabled={busy} onPress={submit}>
          <Text style={commonStyles.primaryButtonText}>{busy ? 'Creating…' : 'Create my login'}</Text>
        </Pressable>
        <Pressable style={{ marginTop: spacing.md }} onPress={() => navigation.goBack()}>
          <Text style={{ color: colors.primary, textAlign: 'center' }}>Back to sign in</Text>
        </Pressable>

        <QrScanner
          visible={scanning}
          title="Scan your parent's QR code"
          accept={(d) => !!codeFromLink(d, 'invite')}
          onClose={() => setScanning(false)}
          onCode={(d) => { setScanning(false); setCode(codeFromLink(d, 'invite')); }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
