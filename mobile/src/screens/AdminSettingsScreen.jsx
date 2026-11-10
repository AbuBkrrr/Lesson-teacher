import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { admin } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function AdminSettingsScreen() {
  const [commission, setCommission] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [sibling, setSibling] = useState('');
  const [guarantee, setGuarantee] = useState('');
  const [instantFee, setInstantFee] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  function applySettings(d) {
    setCommission(String(d.commission_percent));
    setBankName(d.transfer_bank_name || '');
    setAccountNumber(d.transfer_account_number || '');
    setAccountName(d.transfer_account_name || '');
    setSibling(String(d.sibling_discount_percent));
    setGuarantee(String(d.satisfaction_guarantee_hours));
    setInstantFee(String(d.instant_payout_fee_percent));
  }

  useEffect(() => {
    admin.getSettings().then(applySettings).catch((e) => setError(e.message));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const d = await admin.updateSettings({
        commission_percent: Number(commission),
        transfer_bank_name: bankName,
        transfer_account_number: accountNumber,
        transfer_account_name: accountName,
        sibling_discount_percent: Number(sibling),
        satisfaction_guarantee_hours: Number(guarantee),
        instant_payout_fee_percent: Number(instantFee),
      });
      applySettings(d);
      setSuccess('Settings saved. This applies to every payment initialized from now on.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Platform settings</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>Controls that apply platform-wide.</Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <View style={commonStyles.card}>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Platform commission (%)</Text>
          <TextInput style={commonStyles.input} value={commission} onChangeText={setCommission} keyboardType="numeric" />
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.xs }}>
            The percentage of every booking payment the platform keeps. The rest goes to the tutor.
          </Text>
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />

        <Text style={{ fontSize: typography.h2, fontWeight: '700', marginBottom: 4 }}>Direct transfer account</Text>
        <Text style={{ fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm }}>
          Shown to parents who choose &quot;Direct transfer&quot; at checkout. Leave blank to hide that option.
        </Text>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Bank name</Text>
          <TextInput style={commonStyles.input} value={bankName} onChangeText={setBankName} placeholder="e.g. GTBank" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Account number</Text>
          <TextInput style={commonStyles.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="e.g. 0123456789" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Account name</Text>
          <TextInput style={commonStyles.input} value={accountName} onChangeText={setAccountName} placeholder="e.g. LessonTeacher Ltd" />
        </View>

        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />
        <Text style={{ fontSize: typography.h2, fontWeight: '700', marginBottom: spacing.sm }}>Pricing rules</Text>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Sibling discount (%)</Text>
          <TextInput style={commonStyles.input} value={sibling} onChangeText={setSibling} keyboardType="numeric" />
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.xs }}>Taken off at checkout when a parent has two or more active children.</Text>
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Refund / reschedule window (hours)</Text>
          <TextInput style={commonStyles.input} value={guarantee} onChangeText={setGuarantee} keyboardType="numeric" />
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.xs }}>How long after a completed lesson a parent can ask for a refund or reschedule.</Text>
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Instant payout fee (%)</Text>
          <TextInput style={commonStyles.input} value={instantFee} onChangeText={setInstantFee} keyboardType="numeric" />
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.xs }}>Charged to tutors who take earnings immediately instead of in the normal batch.</Text>
        </View>

        <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          <Text style={commonStyles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
