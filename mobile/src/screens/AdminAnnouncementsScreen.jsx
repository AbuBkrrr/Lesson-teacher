import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { admin } from '../api/client';
import { confirmAction } from '../utils/confirm';
import { commonStyles, spacing, colors } from '../theme';

const AUDIENCES = [['all', 'Everyone'], ['parent', 'Parents'], ['adult_student', 'Adult students'], ['tutor', 'Tutors'], ['child', 'Children'], ['school_admin', 'School admins']];

export default function AdminAnnouncementsScreen() {
  const [audience, setAudience] = useState('all');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const ready = subject.trim() && body.trim() && !busy;
  const label = AUDIENCES.find((a) => a[0] === audience)[1].toLowerCase();

  async function send() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await admin.announce({ audience, subject, body });
      setDone(`Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}.`);
      setSubject(''); setBody('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={{ color: colors.muted, marginBottom: spacing.md }}>Appears in everyone&apos;s Notifications and goes out by email, SMS and push. It cannot be recalled.</Text>
      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {done && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{done}</Text></View>}
      <Text style={{ fontWeight: '600', marginBottom: spacing.xs }}>Send to</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
        {AUDIENCES.map(([v, l]) => (
          <Pressable key={v} onPress={() => setAudience(v)} accessibilityRole="button" accessibilityState={{ selected: audience === v }}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, backgroundColor: audience === v ? colors.primary : 'transparent' }}>
            <Text style={{ color: audience === v ? '#fff' : colors.primary }}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={commonStyles.input} placeholder="Subject" accessibilityLabel="Subject" maxLength={120} value={subject} onChangeText={setSubject} />
      <TextInput style={[commonStyles.input, { height: 120, textAlignVertical: 'top', marginTop: spacing.sm }]} placeholder="Message" accessibilityLabel="Message" multiline maxLength={2000} value={body} onChangeText={setBody} />
      <Pressable style={[commonStyles.primaryButton, { marginTop: spacing.md }, !ready && commonStyles.buttonDisabled]} disabled={!ready}
        onPress={() => confirmAction('Send announcement?', `This goes to ${label} now and cannot be recalled.`, send, 'Yes, send')}>
        <Text style={commonStyles.primaryButtonText}>{busy ? 'Sending…' : 'Send announcement'}</Text>
      </Pressable>
    </ScrollView>
  );
}
