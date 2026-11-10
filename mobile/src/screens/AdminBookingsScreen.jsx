import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { admin, bookings } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { confirmAction } from '../utils/confirm';
import { commonStyles, spacing, typography, colors } from '../theme';

const STATUSES = ['', 'pending', 'confirmed', 'completed', 'cancelled'];

export default function AdminBookingsScreen() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((n = 1) => admin.bookings({ page: n, page_size: 25, ...(status ? { status } : {}) })
    .then((d) => { setRows((prev) => (n === 1 || !prev ? d.bookings : [...prev, ...d.bookings])); setTotal(d.total); setPage(n); setError(null); })
    .catch((e) => setError(e.message)), [status]);
  useEffect(() => { load(1); }, [load]);

  async function cancel(b) {
    setBusyId(b.id);
    try { await bookings.updateStatus(b.id, 'cancelled'); await load(1); } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={rows || []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
        onEndReached={() => { if (rows && rows.length < total) load(page + 1); }}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
            {STATUSES.map((s) => (
              <Pressable key={s || 'all'} accessibilityRole="button" accessibilityState={{ selected: status === s }} onPress={() => setStatus(s)}
                style={[commonStyles.secondaryButton, { paddingVertical: 6, paddingHorizontal: spacing.sm }, status === s && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}>
                <Text style={commonStyles.secondaryButtonText}>{s || 'All'}</Text>
              </Pressable>
            ))}
          </View>
        }
        ListEmptyComponent={<Text style={commonStyles.emptyStateText}>{rows === null && !error ? 'Loading…' : 'No bookings match this filter.'}</Text>}
        renderItem={({ item: b }) => (
          <View style={commonStyles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', flex: 1 }}>{b.parent_name} → {b.tutor_name}</Text>
              <StatusBadge status={b.status} />
            </View>
            <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
              {b.subject || 'Lesson'} · {b.scheduled_at ? new Date(b.scheduled_at).toLocaleString() : 'No time set'}
            </Text>
            {b.payment_status && <Text style={{ fontSize: typography.small, color: colors.muted }}>Payment: {b.payment_status.replace(/_/g, ' ')} · {b.currency} {Number(b.payment_amount).toLocaleString()}</Text>}
            {(b.status === 'pending' || b.status === 'confirmed') && (
              <Pressable style={[commonStyles.dangerButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]} disabled={busyId === b.id}
                onPress={() => confirmAction('Cancel this booking?', 'Both people will be notified.', () => cancel(b), 'Yes, cancel')}>
                <Text style={commonStyles.dangerButtonText}>Cancel booking</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}
