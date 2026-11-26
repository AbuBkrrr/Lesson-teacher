import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { children as childrenApi, progress } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { commonStyles, spacing, colors } from '../theme';

const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({ label, value }) {
  return (
    <View style={[commonStyles.card, { flexBasis: '47%', flexGrow: 1, marginBottom: 0 }]}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={{ color: colors.muted }}>{label}</Text>
    </View>
  );
}

/** Parent: pick a child and see their report. Child: their own report. */
export default function ProgressScreen() {
  const { user } = useAuth();
  const isChild = user?.role === 'child';
  const [kids, setKids] = useState([]);
  const [childId, setChildId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (isChild) { setData(await progress.me()); return; }
      const { children } = await childrenApi.mine();
      setKids(children);
      const id = childId || children[0]?.id;
      if (id) { setChildId(id); setData(await progress.child(id)); } else setData(null);
    } catch (e) { setError(e.message); }
  }, [isChild, childId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const s = data?.summary;
  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {!isChild && kids.length === 0 && <Text style={commonStyles.emptyStateText}>Add a child under My children to see their progress.</Text>}
      {!isChild && kids.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }} accessibilityRole="tablist">
          {kids.map((k) => (
            <Pressable key={k.id} onPress={() => setChildId(k.id)} accessibilityRole="tab" accessibilityState={{ selected: k.id === childId }}
              style={[commonStyles.badge, { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: k.id === childId ? colors.primary : colors.card }]}>
              <Text style={{ color: k.id === childId ? '#fff' : colors.text, fontWeight: '600' }}>{k.full_name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {data && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
            <Stat label="Lessons completed" value={s.completed_lessons} />
            <Stat label="Hours learned" value={s.hours_learned} />
            <Stat label="Average score" value={s.average_score ?? '—'} />
            <Stat label="Day streak" value={s.streak?.current ?? 0} />
          </View>

          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: spacing.sm }}>Skills</Text>
          {data.skills.length === 0 && <Text style={commonStyles.emptyStateText}>Skill levels appear after the first completed lesson.</Text>}
          {data.skills.map((sk) => {
            const step = LEVELS.indexOf(sk.level) + 1;
            return (
              <View key={sk.skill_id} style={commonStyles.card}>
                <Text style={{ fontWeight: '700' }}>{sk.icon} {sk.skill_name}</Text>
                <Text style={{ color: colors.muted, marginBottom: 6 }}>
                  {cap(sk.level)} · {sk.completed_lessons} lesson{sk.completed_lessons === 1 ? '' : 's'}{sk.average_score !== null ? ` · avg ${sk.average_score}` : ''}
                </Text>
                <View style={{ height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}
                  accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: 4, now: step }} accessibilityLabel={`${sk.skill_name} level ${sk.level}`}>
                  <View style={{ width: `${step * 25}%`, height: 8, backgroundColor: colors.primary }} />
                </View>
              </View>
            );
          })}

          {data.upcoming_lessons.length > 0 && (
            <>
              <Text style={{ fontSize: 18, fontWeight: '800', marginVertical: spacing.sm }}>Coming up</Text>
              {data.upcoming_lessons.map((l) => (
                <Text key={l.id} style={{ marginBottom: 4 }}>{new Date(l.scheduled_at).toLocaleString()} · {l.subject || 'Lesson'} with {l.tutor_name}</Text>
              ))}
            </>
          )}

          <Text style={{ fontSize: 18, fontWeight: '800', marginVertical: spacing.sm }}>Tutor reports</Text>
          {data.recent_reports.length === 0 && <Text style={commonStyles.emptyStateText}>No lesson reports yet.</Text>}
          {data.recent_reports.map((r) => (
            <View key={r.id} style={commonStyles.card}>
              <Text style={{ fontWeight: '700' }}>{r.skill_name || r.subject || 'Lesson'} · {new Date(r.scheduled_at || r.created_at).toLocaleDateString()}</Text>
              <Text style={{ color: colors.muted }}>By {r.tutor_name}{r.score !== null ? ` · score ${r.score}/100` : ''}</Text>
              <Text style={{ marginTop: 4 }}>{r.summary}</Text>
              {r.strengths ? <Text style={{ marginTop: 4 }}>Strengths: {r.strengths}</Text> : null}
              {r.next_steps ? <Text style={{ marginTop: 4 }}>Next steps: {r.next_steps}</Text> : null}
              {r.homework ? <Text style={{ marginTop: 4 }}>Homework: {r.homework}</Text> : null}
            </View>
          ))}

          {data.badges.length > 0 && (
            <Text style={{ marginTop: spacing.sm }}>{data.badges.map((b) => `${b.icon || '🏅'} ${b.name}`).join('   ')}</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
