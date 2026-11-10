import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { admin, refundRequests } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { confirmAction } from '../utils/confirm';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminRefundsScreen() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => Promise.all([admin.refunds({ status: 'pending', page_size: 50 }), admin.refunds({ status: 'approved', page_size: 50 })])
    .then(([pending, approved]) => { setRows([...pending.refunds, ...approved.refunds]); setError(null); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function resolve(r, status) {
    setBusyId(r.id);
    try { await refundRequests.resolve(r.id, { status }); await load(); } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={rows || []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={<Text style={{ color: colors.muted, marginBottom: spacing.md }}>Approve or deny. Mark Completed once the money has been returned through your payment provider.</Text>}
        ListEmptyComponent={<Text style={commonStyles.emptyStateText}>{rows === null && !error ? 'Loading…' : 'No open refund requests.'}</Text>}
        renderItem={({ item: r }) => (
          <View style={commonStyles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', flex: 1 }}>{r.requester_name} · {r.subject || 'Lesson'} with {r.tutor_name}</Text>
              <StatusBadge status={r.status} />
            </View>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginVertical: spacing.xs }}>
              {r.resolution === 'reschedule' ? 'Wants to reschedule' : `Wants ${r.currency} ${Number(r.amount).toLocaleString()} back`}
            </Text>
            <Text>“{r.reason}”</Text>
            {r.payout_id && r.resolution === 'refund' && <Text style={{ color: '#b91c1c', marginTop: spacing.xs }}>Already paid out to the tutor.</Text>}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
              {r.status === 'pending' && (
                <Pressable style={commonStyles.primaryButton} disabled={busyId === r.id} onPress={() => resolve(r, 'approved')}><Text style={commonStyles.primaryButtonText}>Approve</Text></Pressable>
              )}
              <Pressable style={commonStyles.primaryButton} disabled={busyId === r.id} onPress={() => confirmAction('Mark as completed?', 'This records the refund as paid out. The payment becomes Refunded.', () => resolve(r, 'completed'), 'Yes, completed')}>
                <Text style={commonStyles.primaryButtonText}>Completed</Text>
              </Pressable>
              <Pressable style={commonStyles.dangerButton} disabled={busyId === r.id} onPress={() => confirmAction('Deny this request?', 'The requester will be notified.', () => resolve(r, 'denied'), 'Yes, deny')}>
                <Text style={commonStyles.dangerButtonText}>Deny</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}
