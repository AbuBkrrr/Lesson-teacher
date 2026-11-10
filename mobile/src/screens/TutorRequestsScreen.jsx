import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { lessonRequests } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function TutorRequestsScreen() {
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState([]);
  const [city, setCity] = useState('');
  const [error, setError] = useState(null);
  const [draftById, setDraftById] = useState({});

  async function load() {
    try {
      const [openRes, mineRes] = await Promise.all([lessonRequests.open({ city }), lessonRequests.myApplications()]);
      setOpen(openRes.lesson_requests);
      setMine(mineRes.applications);
    } catch (e) {
      setError(e.message);
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [city]);

  const appliedIds = new Set(mine.map((a) => a.request_id));

  async function apply(requestId) {
    setError(null);
    const draft = draftById[requestId] || {};
    try {
      await lessonRequests.apply(requestId, { message: draft.message, proposed_rate: draft.rate ? Number(draft.rate) : undefined });
      await load();
    } catch (err) {
      setError(err.message || 'Could not apply');
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Browse lesson requests</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Parents and adult students post what they need. Apply with a message and your rate.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      <View style={commonStyles.field}>
        <Text style={commonStyles.label}>Filter by city</Text>
        <TextInput style={commonStyles.input} value={city} onChangeText={setCity} />
      </View>

      {open.length === 0 && <Text style={commonStyles.emptyStateText}>No open requests right now.</Text>}

      {open.map((r) => {
        const applied = appliedIds.has(r.id);
        return (
          <View key={r.id} style={commonStyles.card}>
            <Text style={{ fontWeight: '700' }}>{r.title}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
              by {r.requester_name}{r.city ? ` · ${r.city}` : ''}
            </Text>
            {r.description && <Text style={{ marginTop: spacing.xs }}>{r.description}</Text>}
            {(r.min_budget || r.max_budget) && (
              <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
                Budget: {r.min_budget || '?'} – {r.max_budget || '?'} {r.currency}
              </Text>
            )}
            {applied ? (
              <Text style={{ color: colors.successFg, fontWeight: '700', marginTop: spacing.sm }}>Already applied</Text>
            ) : (
              <View style={{ marginTop: spacing.sm }}>
                <TextInput
                  style={[commonStyles.input, { height: 60, textAlignVertical: 'top', marginBottom: spacing.xs }]}
                  placeholder="Your message"
                  value={draftById[r.id]?.message || ''}
                  onChangeText={(v) => setDraftById((m) => ({ ...m, [r.id]: { ...m[r.id], message: v } }))}
                  multiline
                />
                <TextInput
                  style={[commonStyles.input, { marginBottom: spacing.sm }]}
                  placeholder="Proposed rate"
                  keyboardType="numeric"
                  value={draftById[r.id]?.rate || ''}
                  onChangeText={(v) => setDraftById((m) => ({ ...m, [r.id]: { ...m[r.id], rate: v } }))}
                />
                <Pressable style={commonStyles.primaryButton} onPress={() => apply(r.id)}>
                  <Text style={commonStyles.primaryButtonText}>Apply</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
