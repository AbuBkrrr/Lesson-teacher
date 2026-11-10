import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import { auditions } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, colors } from '../theme';

export default function TutorAuditionsScreen() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [videoUrls, setVideoUrls] = useState({});

  function load() {
    auditions.mine().then((d) => setRows(d.auditions)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function updateStatus(id, status) {
    setBusyId(id);
    setError(null);
    try {
      await auditions.updateStatus(id, status, videoUrls[id]);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Auditions</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Audition requests from parents, before they book a full session.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {rows.length === 0 && <Text style={commonStyles.emptyStateText}>No auditions yet.</Text>}
      {rows.map((a) => (
        <View key={a.id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ fontWeight: '700' }}>{a.parent_name}</Text>
            <StatusBadge status={a.status} />
          </View>
          {a.video_url && (
            <Pressable onPress={() => Linking.openURL(a.video_url)}>
              <Text style={{ color: colors.primary, marginTop: 4 }}>Watch video</Text>
            </Pressable>
          )}

          {a.status === 'pending' && (
            <View style={{ marginTop: spacing.sm }}>
              <TextInput
                style={[commonStyles.input, { marginBottom: spacing.sm }]}
                placeholder="Video URL"
                value={videoUrls[a.id] || ''}
                onChangeText={(v) => setVideoUrls((m) => ({ ...m, [a.id]: v }))}
              />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Pressable style={commonStyles.primaryButton} disabled={busyId === a.id} onPress={() => updateStatus(a.id, 'ready')}>
                  <Text style={commonStyles.primaryButtonText}>Mark ready</Text>
                </Pressable>
                <Pressable style={commonStyles.dangerButton} disabled={busyId === a.id} onPress={() => updateStatus(a.id, 'declined')}>
                  <Text style={commonStyles.dangerButtonText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          )}
          {a.status === 'ready' && (
            <Pressable style={[commonStyles.primaryButton, { marginTop: spacing.sm }]} disabled={busyId === a.id} onPress={() => updateStatus(a.id, 'completed')}>
              <Text style={commonStyles.primaryButtonText}>Mark completed</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
