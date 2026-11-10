import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { forgotPassword } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

// The app has no deep-link handler for reset tokens, so the actual password
// change happens on the web portal's link in the email/SMS — this screen's
// job is only to trigger that message and point the user there.
export default function ForgotPasswordScreen({ navigation }) {
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(identifier.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Lesson Teacher</Text>
        <Text style={styles.tagline}>Reset your password</Text>

        {error && (
          <View style={commonStyles.errorBanner}>
            <Text style={commonStyles.errorBannerText}>{error}</Text>
          </View>
        )}

        {sent ? (
          <Text style={styles.body}>
            If an account matches {identifier}, we&apos;ve sent reset instructions to it. Open the link on your
            email or SMS to choose a new password, then come back here to sign in.
          </Text>
        ) : (
          <>
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

            <Pressable
              style={[commonStyles.primaryButton, submitting && commonStyles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={commonStyles.primaryButtonText}>{submitting ? 'Sending…' : 'Send reset instructions'}</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkText}>← Back to sign in</Text>
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
  body: {
    fontSize: typography.body,
    color: colors.text,
    lineHeight: 22,
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
