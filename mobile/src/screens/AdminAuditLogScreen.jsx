import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { admin } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function AdminAuditLogScreen() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => admin.auditLog(1).then((d) => setEntries(d.entries)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No admin actions recorded yet.</Text></View>}
        renderItem={({ item: e }) => (
          <View style={commonStyles.card}>
            <Text style={styles.action}>{e.action}</Text>
            <Text style={styles.meta}>{e.admin_name} · {new Date(e.created_at).toLocaleString()}</Text>
            {e.target_id ? <Text style={styles.meta}>{e.target_type}: {e.target_id}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  action: { fontSize: typography.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
});
