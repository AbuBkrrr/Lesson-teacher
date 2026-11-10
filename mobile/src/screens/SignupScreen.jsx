import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, commonStyles } from '../theme';

const ROLES = [
  { value: 'parent', label: 'Parent', blurb: 'Book tutors and manage your children’s lessons.' },
  { value: 'adult_student', label: 'Adult Student (18+)', blurb: 'Learn directly — no parent account needed.' },
  { value: 'tutor', label: 'Tutor', blurb: 'Teach, get booked, and get paid.' },
  { value: 'school_admin', label: 'School', blurb: 'Manage students, tutors, and curriculum.' },
];

export default function SignupScreen({ navigation }) {
  const { signup } = useAuth();
  const [role, setRole] = useState('parent');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [schoolJoinCode, setSchoolJoinCode] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState(''); // YYYY-MM-DD
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignup() {
    setError(null);
    if (!fullName || !password || (!email && !phone)) {
      setError('Name, password, and an email or phone number are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (role === 'adult_student' && !dateOfBirth) {
      setError('Date of birth is required to sign up as an adult student (must be 18+).');
      return;
    }
    if (role === 'school_admin' && !schoolName) {
      setError('School name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = { role, full_name: fullName, email: email || undefined, phone: phone || undefined, password };
      if (role === 'parent') payload.school_join_code = schoolJoinCode.trim() || undefined;
      if (role === 'school_admin') payload.school_name = schoolName;
      if (role === 'adult_student') payload.date_of_birth = dateOfBirth;
      await signup(payload);
    } catch (err) {
      setError(err.message || 'Could not create your account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Create your account</Text>
        <Text style={styles.tagline}>Every account is verified for everyone&apos;s safety</Text>

        {error && (
          <View style={commonStyles.errorBanner}>
            <Text style={commonStyles.errorBannerText}>{error}</Text>
          </View>
        )}

        <View style={{ marginBottom: spacing.md }}>
          {ROLES.map((r) => (
            <Pressable
              key={r.value}
              style={[styles.roleCard, role === r.value && styles.roleCardSelected]}
              onPress={() => setRole(r.value)}
            >
              <Text style={styles.roleLabel}>{r.label}</Text>
              <Text style={styles.roleBlurb}>{r.blurb}</Text>
            </Pressable>
          ))}
        </View>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Full name</Text>
          <TextInput style={commonStyles.input} value={fullName} onChangeText={setFullName} autoComplete="name" />
        </View>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Email</Text>
          <TextInput style={commonStyles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        </View>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Phone (optional if email given)</Text>
          <TextInput style={commonStyles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        </View>

        {role === 'adult_student' && (
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Date of birth (YYYY-MM-DD)</Text>
            <TextInput style={commonStyles.input} value={dateOfBirth} onChangeText={setDateOfBirth} placeholder="2000-01-31" />
            <Text style={styles.helperText}>You must be 18 or older.</Text>
          </View>
        )}

        {role === 'school_admin' && (
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>School name</Text>
            <TextInput style={commonStyles.input} value={schoolName} onChangeText={setSchoolName} />
          </View>
        )}

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Password</Text>
          <TextInput style={commonStyles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        </View>

        {role === 'parent' && (
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>School join code (optional)</Text>
            <TextInput
              style={commonStyles.input}
              value={schoolJoinCode}
              onChangeText={setSchoolJoinCode}
              autoCapitalize="characters"
              placeholder="e.g. SCH-3VRZFMFK"
            />
          </View>
        )}

        <Pressable
          style={[commonStyles.primaryButton, submitting && commonStyles.buttonDisabled]}
          onPress={handleSignup}
          disabled={submitting}
        >
          <Text style={commonStyles.primaryButtonText}>{submitting ? 'Creating account…' : 'Create account'}</Text>
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkText}>Already have an account? Sign in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.background },
  logo: { fontSize: typography.h1, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.xs },
  tagline: { fontSize: typography.body, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
  linkRow: { marginTop: spacing.md, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '600' },
  roleCard: { borderWidth: 1, borderColor: colors.border || '#ddd', borderRadius: 10, padding: spacing.sm, marginBottom: spacing.xs },
  roleCardSelected: { borderColor: colors.primary, borderWidth: 2 },
  roleLabel: { fontWeight: '700', color: colors.text },
  roleBlurb: { color: colors.muted, fontSize: typography.small || 12 },
  helperText: { color: colors.muted, fontSize: typography.small || 12, marginTop: 4 },
});
