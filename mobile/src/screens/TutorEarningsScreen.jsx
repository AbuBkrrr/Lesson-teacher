import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { tutors, payments, payouts } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function TutorEarningsScreen() {
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState(null);
  const [payoutHistory, setPayoutHistory] = useState([]);
  const [bankForm, setBankForm] = useState({ bank_name: '', bank_code: '', account_number: '', account_name: '' });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);

  function load() {
    tutors.myProfile().then((d) => {
      setProfile(d.profile);
      setBankForm({
        bank_name: d.profile.bank_name || '', bank_code: d.profile.bank_code || '',
        account_number: d.profile.account_number || '', account_name: d.profile.account_name || '',
      });
    }).catch((e) => setError(e.message));
    payments.earningsSummary().then(setSummary).catch(() => {});
    payouts.mine().then((d) => setPayoutHistory(d.payouts)).catch(() => {});
  }
  useEffect(load, []);

  const update = (field) => (value) => setBankForm((f) => ({ ...f, [field]: value }));
  const currency = profile?.currency || 'NGN';

  async function handleSaveBank() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await tutors.updateBankAccount(bankForm);
      setSuccess('Bank account saved. You can now receive payouts.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleInstantPayout() {
    setError(null);
    setSuccess(null);
    setCashingOut(true);
    try {
      const res = await payouts.requestInstant();
      setSuccess(`Instant payout sent: ${res.payout.currency} ${res.payout.amount.toLocaleString()} (fee: ${res.fee.toLocaleString()})`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCashingOut(false);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Earnings</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        What you&apos;ve earned from confirmed, paid sessions, and your payout history.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      {summary && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          <StatCard label="Total earned" value={`${currency} ${summary.total_earned.toLocaleString()}`} />
          <StatCard label="Paid out" value={`${currency} ${summary.already_paid_out.toLocaleString()}`} />
          <StatCard label="Pending" value={`${currency} ${summary.pending_payout.toLocaleString()}`} />
        </View>
      )}

      {summary?.pending_payout > 0 && (
        <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.md }]} disabled={cashingOut} onPress={handleInstantPayout}>
          <Text style={commonStyles.secondaryButtonText}>{cashingOut ? 'Processing…' : '⚡ Cash out now (instant payout, small fee applies)'}</Text>
        </Pressable>
      )}

      <View style={commonStyles.card}>
        <Text style={styles.title}>Payout bank account</Text>
        <Text style={{ fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm }}>
          Where your earnings are sent when the platform pays out.
        </Text>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Bank name</Text>
          <TextInput style={commonStyles.input} value={bankForm.bank_name} onChangeText={update('bank_name')} placeholder="e.g. GTBank" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Bank code</Text>
          <TextInput style={commonStyles.input} value={bankForm.bank_code} onChangeText={update('bank_code')} placeholder="e.g. 058" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Account number</Text>
          <TextInput style={commonStyles.input} value={bankForm.account_number} onChangeText={update('account_number')} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Account name</Text>
          <TextInput style={commonStyles.input} value={bankForm.account_name} onChangeText={update('account_name')} />
        </View>
        <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleSaveBank} disabled={saving}>
          <Text style={commonStyles.primaryButtonText}>{saving ? 'Saving…' : 'Save bank account'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.title, { marginTop: spacing.md }]}>Payout history</Text>
      {payoutHistory.length === 0 && <Text style={commonStyles.emptyStateText}>No payouts yet.</Text>}
      {payoutHistory.map((p) => (
        <View key={p.id} style={commonStyles.card}>
          <View style={styles.rowBetween}>
            <Text>{new Date(p.created_at).toLocaleDateString()}</Text>
            <StatusBadge status={p.status} />
          </View>
          <Text style={{ marginTop: 4 }}>{p.currency} {p.amount.toLocaleString()}</Text>
        </View>
      ))}
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
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
