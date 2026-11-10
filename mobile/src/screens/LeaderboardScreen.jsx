import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { gamification } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function LeaderboardScreen() {
  const { user } = useAuth();
  const isChild = user?.role === 'child';
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    const fetchLeaderboard = isChild ? gamification.schoolLeaderboard() : gamification.siblingLeaderboard();
    fetchLeaderboard
      .then((d) => setRows([...d.leaderboard].sort((a, b) => b.total_points - a.total_points)))
      .catch((e) => setError(e.message));
  }, [isChild]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={commonStyles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.child_id}
        contentContainerStyle={commonStyles.screenContent}
        ListHeaderComponent={error ? <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View> : null}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={commonStyles.emptyStateText}>
              {isChild ? 'No school leaderboard yet.' : 'Add more than one child to see a leaderboard.'}
            </Text>
          </View>
        }
        renderItem={({ item: r, index }) => (
          <View style={[commonStyles.card, styles.row]}>
            <Text style={styles.rank}>#{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{r.full_name || r.display_name}</Text>
              <Text style={styles.meta}>🔥 {r.current_streak}-day streak</Text>
            </View>
            <Text style={styles.points}>⭐ {r.total_points}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { fontSize: typography.h2, fontWeight: '800', color: colors.primary, width: 36 },
  name: { fontSize: typography.body, fontWeight: '600', color: colors.text },
  meta: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  points: { fontSize: typography.body, fontWeight: '700', color: colors.text },
});
