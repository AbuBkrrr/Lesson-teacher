import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { tutors } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function SavedTutorsScreen() {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => tutors.favorites().then((d) => setList(d.tutors)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function remove(id) {
    try {
      await tutors.removeFavorite(id);
      setList((l) => l.filter((t) => (t.user_id || t.id) !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={list}
        keyExtractor={(t) => String(t.user_id || t.id)}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={commonStyles.emptyStateText}>No saved tutors yet. Tap “☆ Save for later” on a tutor in Discover.</Text>
          </View>
        }
        renderItem={({ item: t }) => (
          <View style={commonStyles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{t.full_name}</Text>
                <Text style={styles.meta}>{(t.subjects || []).join(', ') || 'No subjects listed yet'}</Text>
              </View>
              <Pressable onPress={() => remove(t.user_id || t.id)} accessibilityLabel="Remove from saved tutors">
                <Text style={styles.star}>★</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: typography.h2, fontWeight: '700', color: colors.text },
  meta: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  star: { fontSize: 28, color: colors.primary, paddingHorizontal: spacing.sm },
});
