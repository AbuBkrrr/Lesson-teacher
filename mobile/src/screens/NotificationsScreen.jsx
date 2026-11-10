import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { notifications } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function NotificationsScreen() {
  const [items, setItems] = useState(null);
  const [meta, setMeta] = useState({ page: 1, total: 0, unread_count: 0 });
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((page = 1, append = false) => {
    return notifications.list(page)
      .then((d) => {
        setError(null);
        setItems((prev) => (append && prev ? [...prev, ...d.notifications] : d.notifications));
        setMeta({ page: d.page, total: d.total, unread_count: d.unread_count });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(1); }, [load]);

  async function markRead(n) {
    if (n.read_at) return;
    setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    setMeta((m) => ({ ...m, unread_count: Math.max(0, m.unread_count - 1) }));
    try { await notifications.markRead(n.id); } catch (e) { setError(e.message); load(1); }
  }
  async function markAll() {
    try { await notifications.markAllRead(); await load(1); } catch (e) { setError(e.message); }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {meta.unread_count > 0 && (
        <Pressable style={{ alignSelf: 'flex-end', padding: spacing.md }} onPress={markAll} accessibilityRole="button">
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Mark all as read ({meta.unread_count})</Text>
        </Pressable>
      )}
      <FlatList
        data={items || []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
        onEndReached={() => { if (items && items.length < meta.total) load(meta.page + 1, true); }}
        ListEmptyComponent={items === null && !error ? <Text style={typography.body}>Loading…</Text> : <Text style={typography.body}>Nothing here yet. Booking updates, payments, assignments and messages will show up here.</Text>}
        renderItem={({ item: n }) => (
          <Pressable
            onPress={() => markRead(n)}
            accessibilityRole="button"
            accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.subject || 'Notification'}. ${n.body}`}
            style={[commonStyles.card, { marginBottom: spacing.sm, opacity: n.read_at ? 0.7 : 1, borderLeftWidth: n.read_at ? 0 : 4, borderLeftColor: colors.primary }]}
          >
            <Text style={{ fontWeight: '700', color: colors.text }}>{n.subject || 'Notification'}</Text>
            <Text style={{ color: colors.text, marginTop: 2 }}>{n.body}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{new Date(n.created_at).toLocaleString()}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
