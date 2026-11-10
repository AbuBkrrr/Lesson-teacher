import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import { assignments } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function ChildAssignmentsScreen() {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);

  function load() {
    assignments.mine().then((d) => setList(d.assignments)).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  async function handleSubmit(id) {
    const content = drafts[id]?.trim();
    if (!content) return;
    setBusyId(id);
    setError(null);
    try {
      await assignments.submit(id, { content });
      setDrafts((d) => ({ ...d, [id]: '' }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = list.filter((a) => a.status === 'assigned');
  const done = list.filter((a) => a.status !== 'assigned');

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>My assignments</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>Work your tutors have sent you.</Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {list.length === 0 && <Text style={commonStyles.emptyStateText}>No assignments yet.</Text>}

      {pending.length > 0 && <Text style={styles.sectionTitle}>To do</Text>}
      {pending.map((a) => (
        <View key={a.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '700' }}>{a.title}</Text>
          {a.instructions && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 4 }}>{a.instructions}</Text>}
          {a.due_at && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>Due {a.due_at.slice(0, 10)}</Text>}
          <TextInput
            style={[commonStyles.input, { height: 80, textAlignVertical: 'top', marginTop: spacing.sm }]}
            placeholder="Write your answer here…"
            value={drafts[a.id] || ''}
            onChangeText={(v) => setDrafts((d) => ({ ...d, [a.id]: v }))}
            multiline
          />
          <Pressable
            style={[commonStyles.primaryButton, { marginTop: spacing.sm }, busyId === a.id && commonStyles.buttonDisabled]}
            onPress={() => handleSubmit(a.id)}
            disabled={busyId === a.id}
          >
            <Text style={commonStyles.primaryButtonText}>{busyId === a.id ? 'Submitting…' : 'Submit'}</Text>
          </Pressable>
        </View>
      ))}

      {done.length > 0 && <Text style={styles.sectionTitle}>Submitted / graded</Text>}
      {done.map((a) => (
        <View key={a.id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ fontWeight: '700' }}>{a.title}</Text>
            <StatusBadge status={a.status} />
          </View>
          {a.submission_content && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 4 }}>{a.submission_content}</Text>}
          {a.submission_file_url && (
            <Pressable onPress={() => Linking.openURL(a.submission_file_url)}>
              <Text style={{ color: colors.primary, marginTop: 4 }}>View my submission</Text>
            </Pressable>
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
  sectionTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
