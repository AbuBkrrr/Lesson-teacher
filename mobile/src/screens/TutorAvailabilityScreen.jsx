import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { tutors } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blank = () => ({ day_of_week: 1, start_time: '09:00', end_time: '17:00' });

export default function TutorAvailabilityScreen() {
  const [slots, setSlots] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tutors.myAvailability().then((d) => setSlots(d.slots || [])).catch((e) => setError(e.message));
  }, []);

  const update = (i, patch) => { setSaved(false); setSlots((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); };

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const d = await tutors.updateMyAvailability(slots.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })), (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })());
      setSlots(d.slots || slots);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!slots) return <View style={commonStyles.screen}><Text style={{ padding: spacing.md }}>{error || 'Loading…'}</Text></View>;

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.help}>Weekly times parents can book you. Use 24-hour HH:MM.</Text>
      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {saved && <Text style={styles.ok}>Availability saved.</Text>}
      {slots.length === 0 && <Text style={styles.help}>No weekly slots yet — add one below.</Text>}

      {slots.map((s, i) => (
        <View key={i} style={commonStyles.card}>
          <View style={styles.days}>
            {DAYS.map((d, idx) => (
              <Pressable key={d} onPress={() => update(i, { day_of_week: idx })} style={[styles.day, s.day_of_week === idx && styles.dayOn]}>
                <Text style={[styles.dayText, s.day_of_week === idx && styles.dayTextOn]}>{d}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.times}>
            <TextInput style={[commonStyles.input, styles.time]} value={s.start_time} onChangeText={(v) => update(i, { start_time: v })} placeholder="09:00" autoCapitalize="none" />
            <Text style={styles.to}>to</Text>
            <TextInput style={[commonStyles.input, styles.time]} value={s.end_time} onChangeText={(v) => update(i, { end_time: v })} placeholder="17:00" autoCapitalize="none" />
            <Pressable onPress={() => { setSaved(false); setSlots((p) => p.filter((_, idx) => idx !== i)); }}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.sm }]} onPress={() => { setSaved(false); setSlots((p) => [...p, blank()]); }}>
        <Text style={commonStyles.secondaryButtonText}>+ Add slot</Text>
      </Pressable>
      <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={save} disabled={saving}>
        <Text style={commonStyles.primaryButtonText}>{saving ? 'Saving…' : 'Save availability'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, marginBottom: spacing.sm, fontSize: typography.body },
  ok: { color: colors.successFg, marginBottom: spacing.sm, fontWeight: '600' },
  days: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  day: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border, marginRight: 6, marginBottom: 6 },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { color: colors.text, fontSize: typography.small },
  dayTextOn: { color: '#fff', fontWeight: '700' },
  times: { flexDirection: 'row', alignItems: 'center' },
  time: { width: 84, marginBottom: 0 },
  to: { marginHorizontal: spacing.sm, color: colors.muted },
  remove: { marginLeft: 'auto', color: colors.danger, fontWeight: '600', paddingLeft: spacing.md },
});
