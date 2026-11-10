import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { deviceLink } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function LoginScreen({ navigation }) {
  const { login, completeDeviceLink } = useAuth();
  const [link, setLink] = useState(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!link) return undefined;
    let stop = false;
    const t = setInterval(() => {
      completeDeviceLink(link.code, link.secret).catch((err) => { if (!stop) { stop = true; setLink(null); setError(err.message || 'Link failed'); } });
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [link, completeDeviceLink]);

  function startLink() {
    setError(null);
    deviceLink.start().then(setLink).catch((err) => setError(err.message));
  }

  async function handleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier, password);
      // No manual navigation needed — the root navigator switches stacks
      // based on AuthContext's user state once login() resolves.
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Lesson Teacher</Text>
        <Text style={styles.tagline}>Sign in to your account</Text>

        {error && (
          <View style={commonStyles.errorBanner}>
            <Text style={commonStyles.errorBannerText}>{error}</Text>
          </View>
        )}

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Email or phone</Text>
          <TextInput
            style={commonStyles.input}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            keyboardType="email-address"
          />
        </View>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Password</Text>
          <TextInput
            style={commonStyles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
        </View>

        <Pressable
          style={[commonStyles.primaryButton, submitting && commonStyles.buttonDisabled]}
          onPress={handleLogin}
          disabled={submitting}
        >
          <Text style={commonStyles.primaryButtonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>

        {link ? (
          <View style={styles.linkRow}>
            <Text style={styles.linkText}>On a signed-in device open Account → Linked devices and enter:</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center', color: colors.text, marginTop: spacing.xs }}>{link.code}</Text>
            <Text style={{ textAlign: 'center', color: colors.muted }}>Waiting for approval…</Text>
          </View>
        ) : (
          <Pressable style={styles.linkRow} onPress={startLink}>
            <Text style={styles.linkText}>Sign in with a code from another device</Text>
          </Pressable>
        )}

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('ForgotPassword')}>
          <Text style={styles.linkText}>Forgot your password?</Text>
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.linkText}>New here? Create a parent account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  logo: {
    fontSize: typography.h1,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  linkRow: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  linkText: {
    color: colors.primary,
    fontWeight: '600',
  },
});
