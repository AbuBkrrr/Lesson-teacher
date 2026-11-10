import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Switch, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { tutors } from '../api/client';
import { commonStyles, spacing, colors } from '../theme';

const MAX_VIDEO_SECONDS = 120;

const CURRENCIES = ['NGN', 'KES', 'UGX', 'GHS', 'ZAR', 'TZS', 'XOF', 'USD', 'EUR', 'GBP'];

export default function TutorProfileScreen({ navigation }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState(null);

  async function pickAndUploadVideo() {
    setVideoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_VIDEO_SECONDS });
    if (result.canceled) return;
    const asset = result.assets[0];
    const seconds = (asset.duration || 0) / 1000; // expo reports milliseconds
    if (!seconds) return setVideoError('Could not read that video’s length. Try another file.');
    if (seconds > MAX_VIDEO_SECONDS + 5) return setVideoError(`That video is ${Math.round(seconds)}s. Please keep it to 2 minutes or less.`);
    setVideoBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name: asset.fileName || 'intro.mp4', type: asset.mimeType || 'video/mp4' });
      fd.append('duration_seconds', String(Math.round(seconds)));
      const { profile } = await tutors.uploadIntroVideo(fd);
      setForm((f) => ({ ...f, ...profile }));
    } catch (e) {
      setVideoError(e.message);
    } finally {
      setVideoBusy(false);
    }
  }

  async function removeVideo() {
    setVideoBusy(true);
    try {
      await tutors.removeIntroVideo();
      setForm((f) => ({ ...f, intro_video_url: null, intro_video_duration_seconds: null }));
    } catch (e) {
      setVideoError(e.message);
    } finally {
      setVideoBusy(false);
    }
  }

  useEffect(() => {
    tutors.myProfile().then((d) => setForm(d.profile)).catch((e) => setError(e.message));
  }, []);

  const update = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { profile } = await tutors.updateMyProfile({
        qualifications: form.qualifications,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
        currency: form.currency || 'NGN',
        bio: form.bio,
        city: form.city,
        country: form.country,
        teaches_online: form.teaches_online !== false,
        teaches_in_person: !!form.teaches_in_person,
      });
      setForm(profile);
      setSuccess('Profile updated.');
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
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>My profile</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Your bio, rate, and qualifications — this is what parents see on your card.
      </Text>

      <View style={[commonStyles.card, { borderColor: '#6c5ce7' }]}>
        <Text>
          Want to show up when parents search by skill? These fields don&apos;t control that — skills and
          proficiency levels are managed separately on{' '}
          <Text style={{ color: '#6c5ce7', fontWeight: '700' }} onPress={() => navigation.navigate('TutorSkills')}>
            My skills
          </Text>
          . Without at least one skill added there, you won&apos;t appear in skill-filtered discovery.
        </Text>
      </View>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <View style={commonStyles.card}>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Qualifications</Text>
          <TextInput style={commonStyles.input} value={form.qualifications || ''} onChangeText={update('qualifications')} placeholder="B.Ed Mathematics" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Hourly rate</Text>
          <TextInput style={commonStyles.input} value={form.hourly_rate != null ? String(form.hourly_rate) : ''} onChangeText={update('hourly_rate')} keyboardType="numeric" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Currency</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {CURRENCIES.map((c) => (
              <Pressable
                key={c}
                style={(form.currency || 'NGN') === c ? commonStyles.primaryButton : commonStyles.secondaryButton}
                onPress={() => update('currency')(c)}
              >
                <Text style={(form.currency || 'NGN') === c ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Bio</Text>
          <TextInput style={[commonStyles.input, { height: 90, textAlignVertical: 'top' }]} value={form.bio || ''} onChangeText={update('bio')} multiline />
        </View>

        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Introduction video (optional)</Text>
          <Text style={{ color: colors.muted, marginBottom: spacing.sm }}>
            A 1–2 minute clip of you describing your skills helps parents get to know you.
          </Text>
          {videoError && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{videoError}</Text></View>}
          {form.intro_video_url ? (
            <>
              <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.sm }]} onPress={() => Linking.openURL(form.intro_video_url)}>
                <Text style={commonStyles.secondaryButtonText}>▶ Watch current video{form.intro_video_duration_seconds ? ` (${form.intro_video_duration_seconds}s)` : ''}</Text>
              </Pressable>
              <Pressable style={[commonStyles.dangerButton, { marginBottom: spacing.sm }, videoBusy && commonStyles.buttonDisabled]} onPress={removeVideo} disabled={videoBusy}>
                <Text style={commonStyles.dangerButtonText}>Remove video</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable style={[commonStyles.secondaryButton, videoBusy && commonStyles.buttonDisabled]} onPress={pickAndUploadVideo} disabled={videoBusy}>
            <Text style={commonStyles.secondaryButtonText}>{videoBusy ? 'Uploading…' : form.intro_video_url ? 'Replace video' : 'Choose a video'}</Text>
          </Pressable>
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>City</Text>
          <TextInput style={commonStyles.input} value={form.city || ''} onChangeText={update('city')} placeholder="e.g. Lagos" />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Country</Text>
          <TextInput style={commonStyles.input} value={form.country || ''} onChangeText={update('country')} placeholder="e.g. Nigeria" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
          <Switch value={form.teaches_online !== false} onValueChange={(v) => update('teaches_online')(v)} />
          <Text style={{ marginLeft: spacing.sm }}>I teach online</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Switch value={!!form.teaches_in_person} onValueChange={(v) => update('teaches_in_person')(v)} />
          <Text style={{ marginLeft: spacing.sm }}>I teach in person</Text>
        </View>
        <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          <Text style={commonStyles.primaryButtonText}>{saving ? 'Saving…' : 'Save profile'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
