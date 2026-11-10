import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { children, gamification } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function ChildBadgesScreen() {
  const [streak, setStreak] = useState(null);
  const [badges, setBadges] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    children.me()
      .then(({ child }) => Promise.all([
        gamification.childStreak(child.id).then((d) => setStreak(d.streak)),
        gamification.childBadges(child.id).then((d) => setBadges(d.badges)),
      ]))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={[commonStyles.screen, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.md }}>My badges</Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {streak && (
        <View style={[commonStyles.card, { flexDirection: 'row', justifyContent: 'space-around' }]}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.statValue}>🔥 {streak.current_streak}</Text>
            <Text style={styles.statLabel}>Day streak</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.statValue}>🏆 {streak.longest_streak}</Text>
            <Text style={styles.statLabel}>Best streak</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.statValue}>⭐ {streak.total_points}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Earned badges</Text>
      {badges.length === 0 && <Text style={commonStyles.emptyStateText}>No badges yet — keep learning to earn your first one!</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {badges.map((b) => (
          <View key={b.code} style={[commonStyles.card, { width: '47%', alignItems: 'center' }]}>
            <Text style={{ fontSize: 32 }}>{b.icon || '🎖️'}</Text>
            <Text style={{ fontWeight: '700', textAlign: 'center', marginTop: 4 }}>{b.name}</Text>
            {b.description && <Text style={{ fontSize: typography.small, color: colors.muted, textAlign: 'center', marginTop: 2 }}>{b.description}</Text>}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = {
  statValue: { fontSize: typography.h2, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  sectionTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
};
