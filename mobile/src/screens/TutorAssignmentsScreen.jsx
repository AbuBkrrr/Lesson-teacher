import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import { assignments, bookings } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function TutorAssignmentsScreen() {
  const [list, setList] = useState([]);
  const [bookedChildren, setBookedChildren] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [childId, setChildId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [gradeDrafts, setGradeDrafts] = useState({});

  function load() {
    assignments.mine().then((d) => setList(d.assignments)).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    bookings.mine().then((d) => {
      const seen = new Map();
      d.bookings.filter((b) => ['confirmed', 'completed'].includes(b.status)).forEach((b) => {
        const key = b.child_id ? `c:${b.child_id}` : `u:${b.parent_id}`;
        if (!seen.has(key)) seen.set(key, b.child_id ? b.child_name : `${b.parent_name} (adult)`);
      });
      setBookedChildren([...seen.entries()].map(([id, name]) => ({ id, name })));
    }).catch(() => {});
  }, []);

  async function handleCreate() {
    if (!childId || !title.trim()) { setError('Student and title are required.'); return; }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await assignments.create({ [childId.startsWith('c:') ? 'child_id' : 'student_user_id']: childId.slice(2), title, instructions, due_at: dueAt || undefined });
      setChildId(''); setTitle(''); setInstructions(''); setDueAt('');
      setSuccess('Assignment sent.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleGrade(id) {
    const draft = gradeDrafts[id];
    if (!draft?.grade) return;
    setError(null);
    try {
      await assignments.grade(id, draft);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Assignments</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Assign work to students you&apos;ve had a confirmed booking with, and grade what comes back.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <View style={commonStyles.card}>
        <Text style={styles.title}>New assignment</Text>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Student</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {bookedChildren.map((c) => (
              <Pressable key={c.id} style={childId === c.id ? commonStyles.primaryButton : commonStyles.secondaryButton} onPress={() => setChildId(c.id)}>
                <Text style={childId === c.id ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>{c.name}</Text>
              </Pressable>
            ))}
            {bookedChildren.length === 0 && <Text style={commonStyles.emptyStateText}>No confirmed students yet.</Text>}
          </View>
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Title</Text>
          <TextInput style={commonStyles.input} value={title} onChangeText={setTitle} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Instructions</Text>
          <TextInput style={[commonStyles.input, { height: 80, textAlignVertical: 'top' }]} value={instructions} onChangeText={setInstructions} multiline />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Due date (optional, YYYY-MM-DD)</Text>
          <TextInput style={commonStyles.input} value={dueAt} onChangeText={setDueAt} placeholder="2026-12-01" />
        </View>
        <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleCreate} disabled={saving}>
          <Text style={commonStyles.primaryButtonText}>{saving ? 'Sending…' : 'Send assignment'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.title, { marginTop: spacing.md }]}>Sent assignments</Text>
      {list.length === 0 && <Text style={commonStyles.emptyStateText}>No assignments yet.</Text>}
      {list.map((a) => (
        <View key={a.id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ fontWeight: '700' }}>{a.title} — {a.child_name}</Text>
            <StatusBadge status={a.status} />
          </View>
          {a.instructions && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 4 }}>{a.instructions}</Text>}

          {a.status === 'submitted' && (
            <View style={{ marginTop: spacing.sm }}>
              {a.submission_content ? (
                <Text>{a.submission_content}</Text>
              ) : a.submission_file_url ? (
                <Pressable onPress={() => Linking.openURL(a.submission_file_url)}>
                  <Text style={{ color: colors.primary }}>View submission</Text>
                </Pressable>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                <TextInput
                  style={[commonStyles.input, { flex: 1 }]}
                  placeholder="Grade (e.g. A, 95%)"
                  value={gradeDrafts[a.id]?.grade || ''}
                  onChangeText={(v) => setGradeDrafts((d) => ({ ...d, [a.id]: { ...d[a.id], grade: v } }))}
                />
                <Pressable style={commonStyles.primaryButton} onPress={() => handleGrade(a.id)}>
                  <Text style={commonStyles.primaryButtonText}>Grade</Text>
                </Pressable>
              </View>
            </View>
          )}
          {a.status === 'graded' && (
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.sm }}>
              Grade: <Text style={{ fontWeight: '700' }}>{a.grade}</Text>{a.feedback ? ` — ${a.feedback}` : ''}
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
