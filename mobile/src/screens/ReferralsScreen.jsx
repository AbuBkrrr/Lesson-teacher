import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { referrals } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function ReferralsScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    referrals.mine().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>My referrals</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Share your code or your email/phone number — anyone who signs up with it is credited to you.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {data && (
        <>
          <View style={commonStyles.card}>
            <Text style={{ fontSize: typography.small, color: colors.muted }}>Your referral code</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: 1, marginTop: 4 }}>{data.referral_code}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <StatCard label="Total referred" value={data.summary.total} />
            <StatCard label="Converted" value={data.summary.converted} />
            <StatCard label="Pending" value={data.summary.pending} />
          </View>

          {data.referrals.length === 0 && <Text style={commonStyles.emptyStateText}>No referrals yet — share your code to get started.</Text>}
          {data.referrals.map((r) => (
            <View key={r.id} style={commonStyles.card}>
              <View style={styles.rowBetween}>
                <Text style={{ fontWeight: '600' }}>{r.referred_name}</Text>
                <StatusBadge status={r.status} />
              </View>
              <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
                {r.referred_role} · signed up {new Date(r.referred_signed_up_at).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value }) {
  return (
    <View style={[commonStyles.card, { flex: 1, marginBottom: 0 }]}>
      <Text style={{ fontSize: typography.h2, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: typography.small, color: colors.muted }}>{label}</Text>
    </View>
  );
}

const styles = {
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
