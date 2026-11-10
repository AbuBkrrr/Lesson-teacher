import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { payouts } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { confirmAction } from '../utils/confirm';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminPayoutsScreen() {
  const [balances, setBalances] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busyId, setBusyId] = useState(null);

  function load() {
    payouts.balances().then((d) => setBalances(d.balances)).catch((e) => setError(e.message));
    payouts.listAll().then((d) => setHistory(d.payouts)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function trigger(tutorId) {
    setBusyId(tutorId);
    setError(null);
    setSuccess(null);
    try {
      await payouts.payoutTutor(tutorId);
      setSuccess('Payout sent.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Payouts</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        What&apos;s owed to each tutor from paid sessions, and the full payout history.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <Text style={styles.title}>Owed balances</Text>
      {balances.length === 0 && <Text style={commonStyles.emptyStateText}>Nothing owed right now.</Text>}
      {balances.map((b) => (
        <View key={b.tutor_id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ fontWeight: '600' }}>{b.full_name}</Text>
            <Text>{b.currency} {b.owed.toLocaleString()}</Text>
          </View>
          <Pressable style={[commonStyles.primaryButton, { marginTop: spacing.sm }]} disabled={busyId === b.tutor_id} onPress={() => confirmAction('Pay out now?', `${b.currency} ${b.owed.toLocaleString()} to ${b.full_name}. This sends real money.`, () => trigger(b.tutor_id), 'Yes, pay out')}>
            <Text style={commonStyles.primaryButtonText}>{busyId === b.tutor_id ? 'Paying…' : 'Pay out'}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[styles.title, { marginTop: spacing.md }]}>Payout history</Text>
      {history.length === 0 && <Text style={commonStyles.emptyStateText}>No payouts yet.</Text>}
      {history.map((p) => (
        <View key={p.id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ fontWeight: '600' }}>{p.tutor_name}</Text>
            <StatusBadge status={p.status} />
          </View>
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
            {new Date(p.created_at).toLocaleDateString()} · {p.currency} {p.amount.toLocaleString()}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
