import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { admin } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminDashboardScreen() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    admin.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  const usersByRole = Object.fromEntries((stats?.users_by_role || []).map((r) => [r.role, r.count]));
  const referralsByStatus = Object.fromEntries((stats?.referrals_by_status || []).map((r) => [r.status, r.count]));

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Platform overview</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>Everything happening across the platform, at a glance.</Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {stats && (
        <>
          <View style={[commonStyles.card, { marginBottom: spacing.md }]}>
            <Text style={{ fontWeight: '700', marginBottom: spacing.xs }}>Needs your attention</Text>
            {[
              ['id_verifications', 'ID verifications to review'],
              ['transfers_to_confirm', 'Bank transfers to confirm'],
              ['refund_requests', 'Refund requests open'],
              ['tutors_owed', 'Tutors waiting to be paid'],
              ['unresolved_referrals', 'Unresolved referrals'],
            ].filter(([k]) => stats.attention?.[k] > 0).map(([k, label]) => (
              <Text key={k}><Text style={{ fontWeight: '800' }}>{stats.attention[k]}</Text> {label}</Text>
            ))}
            {Object.values(stats.attention || {}).every((n) => !n) && <Text>Nothing is waiting on you.</Text>}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
            <StatCard label="Parents" value={usersByRole.parent || 0} />
            <StatCard label="Tutors" value={usersByRole.tutor || 0} />
            <StatCard label="School admins" value={usersByRole.school_admin || 0} />
            <StatCard label="Schools" value={stats.total_schools} />
            <StatCard label="Bookings" value={stats.total_bookings} />
          </View>

          <View style={commonStyles.card}>
            <Text style={styles.title}>Referral pipeline</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
              <MiniStat label="Pending" value={referralsByStatus.pending || 0} />
              <MiniStat label="Converted" value={referralsByStatus.converted || 0} />
              <MiniStat label="Unresolved" value={referralsByStatus.unresolved || 0} />
              <MiniStat label="Invalid" value={referralsByStatus.invalid || 0} />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value }) {
  return (
    <View style={[commonStyles.card, { marginBottom: 0, minWidth: '45%', flexGrow: 1 }]}>
      <Text style={{ fontSize: typography.h1, fontWeight: '800', color: colors.text }}>{value ?? '—'}</Text>
      <Text style={{ fontSize: typography.small, color: colors.muted }}>{label}</Text>
    </View>
  );
}

function MiniStat({ label, value }) {
  return (
    <View>
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: typography.small, color: colors.muted }}>{label}</Text>
    </View>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
};
