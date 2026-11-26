import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { auditions } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, colors } from '../theme';

const TYPE_LABEL = { video: 'Video', live: 'Live session', portfolio: 'Portfolio', challenge: 'Challenge' };
const LINK_LABEL = { video: 'Video link (https://…)', portfolio: 'Portfolio link (https://…)', challenge: 'Link to your answer (https://…)', live: 'Meeting link (optional)' };
const OPEN_LABEL = { video: 'Watch video', portfolio: 'Open portfolio', challenge: 'Open answer', live: 'Join meeting' };

/** Parses "YYYY-MM-DD HH:MM" typed in local time. */
function parseLocal(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec((text || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function AuditionsScreen() {
  const { user } = useAuth();
  const isTutor = user?.role === 'tutor';
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [forms, setForms] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => auditions.mine().then((d) => setRows(d.auditions)).catch((e) => setError(e.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setField = (id, k, v) => setForms((f) => ({ ...f, [id]: { ...f[id], [k]: v } }));

  async function run(id, fn, ok) {
    setBusyId(id); setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); await load(); } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  function submit(a) {
    const f = forms[a.id] || {};
    const extra = { tutor_note: f.note || undefined };
    if (a.type === 'live') {
      const iso = parseLocal(f.when);
      if (!iso) { setError('Enter the session time as YYYY-MM-DD HH:MM'); return; }
      extra.scheduled_at = iso;
    }
    run(a.id, () => auditions.updateStatus(a.id, 'ready', f.url || undefined, extra), 'Sent to the parent.');
  }

  function review(a, decision) {
    const f = forms[a.id] || {};
    run(a.id, () => auditions.review(a.id, { rating: f.rating, decision, feedback: f.feedback || undefined }),
      decision === 'accepted' ? 'Accepted. You can now book lessons with this tutor.' : 'Thanks, your feedback was sent.');
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Auditions</Text>
      <Text style={{ color: colors.muted, marginBottom: spacing.md }}>
        {isTutor ? 'Parents ask for an audition before booking. Reply with a link, or a time for a short live session.'
          : 'See how a tutor teaches before you book. Rate each audition and accept or decline the tutor.'}
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {notice && <Text style={{ color: colors.success || '#065f46', marginBottom: spacing.sm }}>{notice}</Text>}
      {rows.length === 0 && <Text style={commonStyles.emptyStateText}>No auditions yet.{isTutor ? '' : ' Swipe up on a tutor in Discover to request one.'}</Text>}

      {rows.map((a) => {
        const f = forms[a.id] || {};
        const busy = busyId === a.id;
        return (
          <View key={a.id} style={commonStyles.card}>
            <View style={styles.rowBetween}>
              <Text style={{ fontWeight: '700', flex: 1 }}>{isTutor ? a.parent_name : a.tutor_name}</Text>
              <StatusBadge status={a.status} />
            </View>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              {TYPE_LABEL[a.type] || 'Video'} audition{a.skill_name ? ` · ${a.skill_name}` : ''}{a.child_name ? ` · for ${a.child_name}` : ''}
            </Text>
            {a.brief && <Text style={{ marginTop: 6 }}><Text style={{ fontWeight: '700' }}>{a.type === 'challenge' ? 'Challenge: ' : 'Request: '}</Text>{a.brief}</Text>}
            {a.tutor_note && <Text style={{ marginTop: 6 }}><Text style={{ fontWeight: '700' }}>Tutor&apos;s note: </Text>{a.tutor_note}</Text>}
            {a.scheduled_at && <Text style={{ marginTop: 6 }}>Live session: {new Date(a.scheduled_at).toLocaleString()}</Text>}
            {a.video_url && (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(a.video_url)}>
                <Text style={{ color: colors.primary, marginTop: 6, fontWeight: '600' }}>{OPEN_LABEL[a.type] || 'Open'}</Text>
              </Pressable>
            )}
            {a.decision && (
              <Text style={{ marginTop: 6 }}>{a.decision === 'accepted' ? 'Accepted' : 'Not accepted'} · {'★'.repeat(a.rating)}{'☆'.repeat(5 - a.rating)}</Text>
            )}
            {a.feedback && <Text style={{ marginTop: 4, color: colors.muted }}>“{a.feedback}”</Text>}

            {isTutor && a.status === 'pending' && (
              <View style={{ marginTop: spacing.sm }}>
                {a.type === 'live' && (
                  <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} placeholder="Session time: YYYY-MM-DD HH:MM"
                    value={f.when || ''} onChangeText={(v) => setField(a.id, 'when', v)} accessibilityLabel="Session time" />
                )}
                <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} placeholder={LINK_LABEL[a.type] || LINK_LABEL.video}
                  autoCapitalize="none" keyboardType="url" value={f.url || ''} onChangeText={(v) => setField(a.id, 'url', v)} accessibilityLabel="Link" />
                <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} placeholder="Note for the parent (optional)" multiline
                  value={f.note || ''} onChangeText={(v) => setField(a.id, 'note', v)} accessibilityLabel="Note for the parent" />
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <Pressable style={[commonStyles.primaryButton, busy && commonStyles.buttonDisabled]} disabled={busy} onPress={() => submit(a)}>
                    <Text style={commonStyles.primaryButtonText}>Send to parent</Text>
                  </Pressable>
                  <Pressable style={commonStyles.dangerButton} disabled={busy} onPress={() => run(a.id, () => auditions.updateStatus(a.id, 'declined'))}>
                    <Text style={commonStyles.dangerButtonText}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {!isTutor && ['ready', 'completed'].includes(a.status) && (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ fontWeight: '700' }}>{a.decision ? 'Change your review' : 'Rate this audition'}</Text>
                <View style={{ flexDirection: 'row', marginVertical: spacing.xs }} accessibilityRole="radiogroup">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setField(a.id, 'rating', n)} hitSlop={6}
                      accessibilityRole="radio" accessibilityState={{ checked: f.rating === n }} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                      <Text style={{ fontSize: 30, color: '#f59e0b', paddingHorizontal: 4 }}>{(f.rating || 0) >= n ? '★' : '☆'}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={[commonStyles.input, { marginBottom: spacing.sm }]} placeholder="Feedback for the tutor (optional)" multiline
                  value={f.feedback || ''} onChangeText={(v) => setField(a.id, 'feedback', v)} accessibilityLabel="Feedback for the tutor" />
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  <Pressable style={[commonStyles.primaryButton, (!f.rating || busy) && commonStyles.buttonDisabled]} disabled={!f.rating || busy} onPress={() => review(a, 'accepted')}>
                    <Text style={commonStyles.primaryButtonText}>Accept tutor</Text>
                  </Pressable>
                  <Pressable style={[commonStyles.secondaryButton, (!f.rating || busy) && commonStyles.buttonDisabled]} disabled={!f.rating || busy} onPress={() => review(a, 'rejected')}>
                    <Text style={commonStyles.secondaryButtonText}>Decline tutor</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = {
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
