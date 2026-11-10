import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Share } from 'react-native';
import { account, resendVerification } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, commonStyles } from '../theme';

// Per-role navigation buttons shown below the account card. Parent/
// adult_student keep their original flat list; tutor, school_admin and
// super_admin each get links to the screens that mirror their portal pages.
const LINKS_BY_ROLE = {
  parent: [
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Linked devices & backup', route: 'LinkedDevices' },
    { label: 'My children', route: 'MyChildren' },
    { label: 'Monitor child–tutor chats', route: 'Monitor' },
    { label: 'Post a search', route: 'PostSearch' },
    { label: 'Saved tutors', route: 'SavedTutors' },
    { label: 'My referrals', route: 'Referrals' },
    { label: 'ID verification', route: 'Verification' },
    { label: 'Leaderboard', route: 'Leaderboard' },
    { label: 'Subscription', route: 'Subscriptions' },
  ],
  child: [
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Linked devices & backup', route: 'LinkedDevices' },
    { label: 'My assignments', route: 'ChildAssignments' },
    { label: 'Curriculum', route: 'Curriculum' },
    { label: 'My badges', route: 'ChildBadges' },
    { label: 'Leaderboard', route: 'Leaderboard' },
  ],
  adult_student: [
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Linked devices & backup', route: 'LinkedDevices' },
    { label: 'My assignments', route: 'ChildAssignments' },
    { label: 'Saved tutors', route: 'SavedTutors' },
    { label: 'Post a search', route: 'PostSearch' },
    { label: 'My referrals', route: 'Referrals' },
    { label: 'ID verification', route: 'Verification' },
    { label: 'Subscription', route: 'Subscriptions' },
  ],
  tutor: [
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Linked devices & backup', route: 'LinkedDevices' },
    { label: 'My profile', route: 'TutorProfile' },
    { label: 'My skills', route: 'TutorSkills' },
    { label: 'My availability', route: 'TutorAvailability' },
    { label: 'Earnings', route: 'TutorEarnings' },
    { label: 'Lesson materials', route: 'TutorMaterials' },
    { label: 'Assignments', route: 'TutorAssignments' },
    { label: 'Curriculum', route: 'Curriculum' },
    { label: 'My referrals', route: 'Referrals' },
    { label: 'ID verification', route: 'Verification' },
  ],
  school_admin: [
    { label: 'School profile', route: 'SchoolProfile' },
    { label: 'Students', route: 'SchoolStudents' },
    { label: 'Curriculum', route: 'Curriculum' },
    { label: 'My referrals', route: 'Referrals' },
    { label: 'ID verification', route: 'Verification' },
  ],
  super_admin: [
    { label: 'Dashboard', route: 'AdminDashboard' },
    { label: 'Users', route: 'AdminUsers' },
    { label: 'Schools', route: 'AdminSchools' },
    { label: 'Verifications', route: 'AdminVerifications' },
    { label: 'Tutors & badges', route: 'AdminTutors' },
    { label: 'Bookings', route: 'AdminBookings' },
    { label: 'Payments to confirm', route: 'AdminPayments' },
    { label: 'Refund requests', route: 'AdminRefunds' },
    { label: 'Payouts', route: 'AdminPayouts' },
    { label: 'Announcements', route: 'AdminAnnouncements' },
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Linked devices & backup', route: 'LinkedDevices' },
    { label: 'Settings', route: 'AdminSettings' },
    { label: 'Audit log', route: 'AdminAuditLog' },
    { label: 'Curriculum', route: 'Curriculum' },
  ],
};

export default function AccountScreen({ navigation }) {
  const { user, logout } = useAuth();
  const links = LINKS_BY_ROLE[user?.role] || [];
  const [verifyState, setVerifyState] = useState('idle'); // idle | sending | sent
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleResend() {
    setVerifyState('sending');
    try { await resendVerification(); setVerifyState('sent'); } catch { setVerifyState('idle'); }
  }

  async function handleExport() {
    setError(null);
    try {
      const data = await account.export();
      await Share.share({ title: 'My Lesson Teacher data', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      await account.delete(password);
      await logout();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <View style={commonStyles.card}>
        <Text style={styles.name}>{user?.full_name}</Text>
        <Text style={styles.meta}>{user?.email || user?.phone}</Text>
        {user?.role && <Text style={styles.roleText}>{user.role.replace(/_/g, ' ')}</Text>}
      </View>

      {user?.email && !user?.email_verified_at && (
        <View style={[commonStyles.card, { backgroundColor: colors.warningBg }]}>
          <Text style={{ color: colors.warningFg, marginBottom: spacing.sm }}>
            {verifyState === 'sent' ? 'Verification email sent — check your inbox.' : 'Please verify your email address.'}
          </Text>
          {verifyState !== 'sent' && (
            <Pressable style={commonStyles.secondaryButton} onPress={handleResend} disabled={verifyState === 'sending'}>
              <Text style={commonStyles.secondaryButtonText}>{verifyState === 'sending' ? 'Sending…' : 'Resend email'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {links.map((link) => (
        <Pressable
          key={link.route}
          style={[commonStyles.secondaryButton, { marginBottom: spacing.sm }]}
          onPress={() => navigation.navigate(link.route)}
        >
          <Text style={commonStyles.secondaryButtonText}>{link.label}</Text>
        </Pressable>
      ))}

      <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.sm }]} onPress={handleExport}>
        <Text style={commonStyles.secondaryButtonText}>Export my data</Text>
      </Pressable>

      <Pressable style={[commonStyles.dangerButton, { marginBottom: spacing.sm }]} onPress={logout}>
        <Text style={commonStyles.dangerButtonText}>Log out</Text>
      </Pressable>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {user?.role !== 'super_admin' && (confirmingDelete ? (
        <View style={commonStyles.card}>
          <Text style={{ color: colors.text, marginBottom: spacing.sm }}>
            This permanently deletes your account. Enter your password to confirm.
          </Text>
          <TextInput style={commonStyles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Password" />
          <Pressable style={[commonStyles.dangerButton, (busy || !password) && commonStyles.buttonDisabled]} onPress={handleDelete} disabled={busy || !password}>
            <Text style={commonStyles.dangerButtonText}>{busy ? 'Deleting…' : 'Delete my account'}</Text>
          </Pressable>
          <Pressable style={{ alignItems: 'center', marginTop: spacing.sm }} onPress={() => { setConfirmingDelete(false); setPassword(''); }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={{ alignItems: 'center', padding: spacing.sm }} onPress={() => setConfirmingDelete(true)}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete account…</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: typography.h2, fontWeight: '800', color: colors.text },
  meta: { fontSize: typography.small, color: colors.muted, marginTop: 4 },
  roleText: { fontSize: typography.small, color: colors.primary, fontWeight: '700', marginTop: 4, textTransform: 'capitalize' },
});
