import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet } from 'react-native';
import { children, childInvites, gamification } from '../api/client';
import { colors, spacing, typography, radius, commonStyles } from '../theme';
import { confirmAction } from '../utils/confirm';
import QrCodeView from '../components/QrCodeView';

export default function MyChildrenScreen() {
  const [list, setList] = useState([]);
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [age, setAge] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [learningNeeds, setLearningNeeds] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null); // { code, expires_at, child_name }
  const [streaks, setStreaks] = useState({}); // child_id -> streak row

  const load = useCallback(() => {
    children.mine().then((d) => {
      setList(d.children);
      d.children.forEach((c) => {
        gamification.childStreak(c.id).then((s) => setStreaks((prev) => ({ ...prev, [c.id]: s.streak }))).catch(() => {});
      });
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!fullName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await children.create({
        full_name: fullName.trim(), grade_level: gradeLevel.trim() || undefined,
        age: age ? Number(age) : undefined, school_name: schoolName.trim() || undefined, learning_needs: learningNeeds.trim() || undefined,
      });
      setFullName('');
      setGradeLevel('');
      setAge('');
      setSchoolName('');
      setLearningNeeds('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGrantLogin(childId) {
    setBusyId(childId);
    setError(null);
    try {
      const info = await childInvites.create(childId);
      setInviteInfo(info);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(childId) {
    setBusyId(childId);
    setError(null);
    try {
      await children.remove(childId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={commonStyles.screenContent}
        ListHeaderComponent={
          <>
            {inviteInfo && (
              <View style={[commonStyles.card, styles.inviteCard]}>
                <Text style={styles.formTitle}>Login code for {inviteInfo.child_name}</Text>
                <Text style={styles.inviteHelp}>
                  Give this code to {inviteInfo.child_name} — with you present, have them open the app, choose
                  “I have a code,” and enter it along with a username and password they pick themselves.
                </Text>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{inviteInfo.code}</Text>
                </View>
                <QrCodeView value={`lessonteacher://invite?code=${inviteInfo.code}`} size={170} label={`QR code for invite ${inviteInfo.code}`} />
                <Text style={styles.expiryText}>Or let them scan this from the app&apos;s sign-in screen.</Text>
                <Text style={styles.expiryText}>Expires {new Date(inviteInfo.expires_at).toLocaleString()}.</Text>
                <Pressable
                  style={commonStyles.secondaryButton}
                  onPress={() => { setInviteInfo(null); load(); }}
                >
                  <Text style={commonStyles.secondaryButtonText}>Done</Text>
                </Pressable>
              </View>
            )}

            <View style={commonStyles.card}>
              <Text style={styles.formTitle}>Add a child</Text>
              {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
              <View style={commonStyles.field}>
                <Text style={commonStyles.label}>Full name</Text>
                <TextInput style={commonStyles.input} value={fullName} onChangeText={setFullName} />
              </View>
              <View style={commonStyles.field}>
                <Text style={commonStyles.label}>Grade level</Text>
                <TextInput style={commonStyles.input} value={gradeLevel} onChangeText={setGradeLevel} placeholder="e.g. Primary 4" />
              </View>
              <View style={commonStyles.field}>
                <Text style={commonStyles.label}>Age</Text>
                <TextInput style={commonStyles.input} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={commonStyles.field}>
                <Text style={commonStyles.label}>School (optional)</Text>
                <TextInput style={commonStyles.input} value={schoolName} onChangeText={setSchoolName} maxLength={200} />
              </View>
              <View style={commonStyles.field}>
                <Text style={commonStyles.label}>Learning needs (optional)</Text>
                <TextInput style={[commonStyles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline value={learningNeeds} onChangeText={setLearningNeeds}
                  maxLength={2000} placeholder="e.g. dyslexia, prefers visual examples" />
                <Text style={styles.expiryText}>Shared with tutors you book so they can adapt lessons.</Text>
              </View>
              <Pressable
                style={[commonStyles.primaryButton, submitting && commonStyles.buttonDisabled]}
                onPress={handleAdd}
                disabled={submitting}
              >
                <Text style={commonStyles.primaryButtonText}>{submitting ? 'Adding…' : 'Add child'}</Text>
              </Pressable>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No children added yet.</Text></View>
        }
        renderItem={({ item: c }) => (
          <View style={commonStyles.card}>
            <View style={styles.childRow}>
              <Text style={styles.childName}>{c.full_name}</Text>
              <Text style={styles.childMeta}>{[c.age ? `Age ${c.age}` : null, c.grade_level].filter(Boolean).join(' · ') || '—'}</Text>
            </View>
            {c.school_name ? <Text style={styles.childMeta}>{c.school_name}</Text> : null}
            {c.learning_needs ? <Text style={styles.childMeta}>Needs: {c.learning_needs}</Text> : null}
            {streaks[c.id] && (
              <Text style={styles.childMeta}>🔥 {streaks[c.id].current_streak}-day streak · ⭐ {streaks[c.id].total_points} pts</Text>
            )}
            <View style={styles.actionsRow}>
              {c.user_id ? (
                <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Has their own login</Text></View>
              ) : (
                <Pressable
                  style={[commonStyles.secondaryButton, styles.smallBtn]}
                  disabled={busyId === c.id}
                  onPress={() => handleGrantLogin(c.id)}
                >
                  <Text style={commonStyles.secondaryButtonText}>Give login</Text>
                </Pressable>
              )}
              <Pressable
                style={[commonStyles.dangerButton, styles.smallBtn]}
                disabled={busyId === c.id}
                onPress={() => confirmAction('Remove this child?', 'Their profile, progress and login will be removed.', () => handleRemove(c.id), 'Yes, remove')}
              >
                <Text style={commonStyles.dangerButtonText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  formTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  childRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  childName: { fontSize: typography.body, fontWeight: '600', color: colors.text },
  childMeta: { fontSize: typography.small, color: colors.muted },
  actionsRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  smallBtn: { paddingVertical: 8, paddingHorizontal: spacing.sm },
  activeBadge: { backgroundColor: colors.successBg, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  activeBadgeText: { color: colors.successFg, fontSize: typography.small, fontWeight: '700' },
  inviteCard: { borderColor: colors.primary },
  inviteHelp: { fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm },
  codeBox: { backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  codeText: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center', color: colors.text },
  expiryText: { fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm },
});
