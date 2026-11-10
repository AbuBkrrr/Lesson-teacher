import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import { kyc } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminVerificationsScreen() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [reasonById, setReasonById] = useState({});

  async function load() {
    try {
      const data = await kyc.pending();
      setUsers(data.users);
    } catch (e) {
      setError(e.message);
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  async function approve(id) {
    setError(null);
    try {
      await kyc.approve(id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not approve');
    }
  }

  async function reject(id) {
    const reason = reasonById[id];
    if (!reason) { setError('Enter a rejection reason first'); return; }
    setError(null);
    try {
      await kyc.reject(id, reason);
      await load();
    } catch (err) {
      setError(err.message || 'Could not reject');
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>ID verification queue</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Review uploaded identity documents. Approving unlocks bookings, auditions, and payouts for that account.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {users.length === 0 && <Text style={commonStyles.emptyStateText}>Nothing pending review.</Text>}

      {users.map((u) => (
        <View key={u.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '700' }}>{u.full_name} <Text style={{ color: colors.muted, fontWeight: '400' }}>({u.role}, {u.email})</Text></Text>
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 4 }}>
            Document: {u.id_document_type || 'Didit session'}{u.didit_session_id ? ` — Didit session ${u.didit_session_id}` : ''}
          </Text>
          {u.id_document_url && (
            <Pressable onPress={() => Linking.openURL(u.id_document_url)}>
              <Text style={{ color: colors.primary, marginTop: 4 }}>View uploaded document</Text>
            </Pressable>
          )}
          <TextInput
            style={[commonStyles.input, { marginTop: spacing.sm, marginBottom: spacing.sm }]}
            placeholder="Rejection reason"
            value={reasonById[u.id] || ''}
            onChangeText={(v) => setReasonById((m) => ({ ...m, [u.id]: v }))}
          />
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Pressable style={commonStyles.primaryButton} onPress={() => approve(u.id)}>
              <Text style={commonStyles.primaryButtonText}>Approve</Text>
            </Pressable>
            <Pressable style={commonStyles.dangerButton} onPress={() => reject(u.id)}>
              <Text style={commonStyles.dangerButtonText}>Reject</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
