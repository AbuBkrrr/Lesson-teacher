import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, Linking } from 'react-native';
import { admin, payments } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { confirmAction } from '../utils/confirm';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminPaymentsScreen() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => admin.payments({ status: 'awaiting_confirmation', page_size: 50 })
    .then((d) => { setRows(d.payments); setError(null); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function confirm(p) {
    setBusyId(p.id);
    try { await payments.confirm(p.id); await load(); } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={rows || []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={<Text style={{ color: colors.muted, marginBottom: spacing.md }}>Bank transfers waiting for you to confirm receipt. Check the proof first.</Text>}
        ListEmptyComponent={<Text style={commonStyles.emptyStateText}>{rows === null && !error ? 'Loading…' : 'No transfers waiting for confirmation.'}</Text>}
        renderItem={({ item: p }) => (
          <View style={commonStyles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600' }}>{p.parent_name} → {p.tutor_name}</Text>
              <StatusBadge status={p.status} />
            </View>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>{p.subject || 'Lesson'} · {p.currency} {Number(p.amount).toLocaleString()}</Text>
            {p.proof_url && (
              <Pressable onPress={() => Linking.openURL(/^https?:/i.test(p.proof_url) ? p.proof_url : `${(process.env.EXPO_PUBLIC_API_BASE || '').replace(/\/api$/, '')}${p.proof_url}`)} accessibilityRole="link">
                <Text style={{ color: colors.primary, marginTop: spacing.xs }}>View proof of payment</Text>
              </Pressable>
            )}
            <Pressable
              style={[commonStyles.primaryButton, { marginTop: spacing.sm }]}
              disabled={busyId === p.id}
              onPress={() => confirmAction('Confirm payment received?', `${p.currency} ${Number(p.amount).toLocaleString()} from ${p.parent_name}. The lesson will be marked paid.`, () => confirm(p), 'Yes, received')}
            >
              <Text style={commonStyles.primaryButtonText}>{busyId === p.id ? 'Confirming…' : 'Confirm received'}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
