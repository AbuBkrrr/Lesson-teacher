import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { bookings } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { commonStyles, spacing, colors } from '../theme';

const FIELDS = [
  ['summary', 'What you covered (required)', 4000],
  ['strengths', 'Strengths', 2000],
  ['next_steps', 'Next steps', 2000],
  ['homework', 'Homework', 2000],
];

/** Tutor writes the lesson report; parent / child read it. route.params.booking */
export default function LessonReportScreen({ route }) {
  const { booking } = route.params;
  const { user } = useAuth();
  const canEdit = user?.role === 'tutor';
  const [report, setReport] = useState(null);
  const [form, setForm] = useState({ summary: '', strengths: '', next_steps: '', homework: '', score: '', engagement: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    bookings.report(booking.id).then(({ report: r }) => {
      setReport(r);
      setForm({ summary: r.summary || '', strengths: r.strengths || '', next_steps: r.next_steps || '', homework: r.homework || '', score: r.score === null ? '' : String(r.score), engagement: r.engagement || 0 });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [booking.id]);

  async function save() {
    setError(null); setSaved(false);
    try {
      const { report: r } = await bookings.saveReport(booking.id, {
        ...form, score: form.score === '' ? null : Number(form.score), engagement: form.engagement || null,
      });
      setReport(r); setSaved(true);
    } catch (e) { setError(e.message); }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 18, fontWeight: '800' }}>{booking.subject || 'Lesson'}{booking.child_name ? ` · ${booking.child_name}` : ''}</Text>
      {booking.scheduled_at && <Text style={{ color: colors.muted, marginBottom: spacing.md }}>{new Date(booking.scheduled_at).toLocaleString()}</Text>}
      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {saved && <Text style={{ color: '#065f46', marginBottom: spacing.sm }}>Report saved. The parent has been notified.</Text>}
      {loading && <Text>Loading…</Text>}

      {!loading && !canEdit && (report ? (
        <View style={commonStyles.card}>
          {FIELDS.map(([k, label]) => report[k] ? (
            <View key={k} style={{ marginBottom: spacing.sm }}>
              <Text style={{ fontWeight: '700' }}>{label.replace(' (required)', '')}</Text>
              <Text>{report[k]}</Text>
            </View>
          ) : null)}
          {report.score !== null && <Text>Score: {report.score}/100</Text>}
          {report.engagement ? <Text>Engagement: {'★'.repeat(report.engagement)}{'☆'.repeat(5 - report.engagement)}</Text> : null}
        </View>
      ) : <Text style={commonStyles.emptyStateText}>The tutor hasn&apos;t written a report for this lesson yet.</Text>)}

      {!loading && canEdit && (
        <>
          {FIELDS.map(([k, label, max]) => (
            <View key={k} style={{ marginBottom: spacing.sm }}>
              <Text style={commonStyles.label}>{label}</Text>
              <TextInput style={[commonStyles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline maxLength={max}
                value={form[k]} onChangeText={(v) => setForm((f) => ({ ...f, [k]: v }))} accessibilityLabel={label} />
            </View>
          ))}
          <Text style={commonStyles.label}>Score (0–100)</Text>
          <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} keyboardType="number-pad" maxLength={3}
            value={form.score} onChangeText={(v) => setForm((f) => ({ ...f, score: v.replace(/\D/g, '') }))} accessibilityLabel="Score" />
          <Text style={commonStyles.label}>Engagement</Text>
          <View style={{ flexDirection: 'row', marginBottom: spacing.md }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setForm((f) => ({ ...f, engagement: n }))} accessibilityRole="radio"
                accessibilityState={{ checked: form.engagement === n }} accessibilityLabel={`Engagement ${n} of 5`} hitSlop={6}>
                <Text style={{ fontSize: 28, color: '#f59e0b', paddingHorizontal: 4 }}>{form.engagement >= n ? '★' : '☆'}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[commonStyles.primaryButton, !form.summary.trim() && commonStyles.buttonDisabled]} disabled={!form.summary.trim()} onPress={save}>
            <Text style={commonStyles.primaryButtonText}>{report ? 'Update report' : 'Save report'}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
