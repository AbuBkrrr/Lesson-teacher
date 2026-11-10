import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { schools } from '../api/client';
import { commonStyles, spacing, colors } from '../theme';

export default function SchoolProfileScreen() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    schools.mine().then((d) => setForm(d.school)).catch((e) => setError(e.message));
  }, []);

  const update = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { school } = await schools.update({
        name: form.name, address: form.address, contact_email: form.contact_email, contact_phone: form.contact_phone,
      });
      setForm(school);
      setSuccess('School profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return (
      <View style={[commonStyles.screen, commonStyles.screenContent]}>
        <Text style={commonStyles.emptyStateText}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>School profile</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        This information is shown to parents and used for your join code.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <View style={commonStyles.card}>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>School name</Text>
          <TextInput style={commonStyles.input} value={form.name || ''} onChangeText={update('name')} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Address</Text>
          <TextInput style={commonStyles.input} value={form.address || ''} onChangeText={update('address')} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Contact email</Text>
          <TextInput style={commonStyles.input} value={form.contact_email || ''} onChangeText={update('contact_email')} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Contact phone</Text>
          <TextInput style={commonStyles.input} value={form.contact_phone || ''} onChangeText={update('contact_phone')} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Join code (share with parents to link their child)</Text>
          <TextInput style={[commonStyles.input, { backgroundColor: colors.background, color: colors.muted }]} value={form.join_code || ''} editable={false} />
        </View>
        <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          <Text style={commonStyles.primaryButtonText}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
