import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl } from 'react-native';
import { admin } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminTutorsScreen() {
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const load = useCallback((n = 1) => admin.tutors({ page: n, page_size: 25, ...(q ? { q } : {}) })
    .then((d) => { setRows((prev) => (n === 1 || !prev ? d.tutors : [...prev, ...d.tutors])); setTotal(d.total); setPage(n); setError(null); })
    .catch((e) => setError(e.message)), [q]);
  useEffect(() => { load(1); }, [load]);

  async function toggle(t) {
    setBusyId(t.user_id);
    try {
      await admin.setTutorVerified(t.user_id, !t.platform_verified);
      setRows((r) => r.map((x) => (x.user_id === t.user_id ? { ...x, platform_verified: t.platform_verified ? 0 : 1 } : x)));
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={rows || []}
        keyExtractor={(t) => t.user_id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
        onEndReached={() => { if (rows && rows.length < total) load(page + 1); }}
        ListHeaderComponent={
          <>
            <Text style={{ color: colors.muted, marginBottom: spacing.sm }}>Give the Platform-verified badge to tutors whose profile and ID you have reviewed.</Text>
            <TextInput style={[commonStyles.input, { marginBottom: spacing.md }]} placeholder="Search name or email" accessibilityLabel="Search tutors" value={query} onChangeText={setQuery} autoCapitalize="none" />
          </>
        }
        ListEmptyComponent={<Text style={commonStyles.emptyStateText}>{rows === null && !error ? 'Loading…' : 'No tutors match.'}</Text>}
        renderItem={({ item: t }) => (
          <View style={commonStyles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', flex: 1 }}>{t.full_name}{t.platform_verified ? '  ✔' : ''}</Text>
              <StatusBadge status={t.status} />
            </View>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>{t.email || '—'}</Text>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>
              ID check: {(t.id_verification_status || 'pending').replace(/_/g, ' ')} · {t.review_count ? `${Number(t.rating).toFixed(1)} ★ (${t.review_count})` : 'No reviews yet'}
            </Text>
            <Pressable style={[t.platform_verified ? commonStyles.secondaryButton : commonStyles.primaryButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]} disabled={busyId === t.user_id} onPress={() => toggle(t)}>
              <Text style={t.platform_verified ? commonStyles.secondaryButtonText : commonStyles.primaryButtonText}>{t.platform_verified ? 'Remove badge' : 'Give badge'}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
