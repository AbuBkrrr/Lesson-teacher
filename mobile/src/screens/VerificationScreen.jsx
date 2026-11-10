import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { kyc, imagePickerAssetToFormDataFile } from '../api/client';
import { commonStyles, spacing, badgeVariantForStatus } from '../theme';

const STATUS_COPY = {
  unverified: { label: 'Not verified', desc: 'Upload a valid ID to unlock bookings, auditions, and payouts.' },
  pending: { label: 'Pending review', desc: 'Your document was received and is awaiting approval.' },
  verified: { label: 'Verified', desc: 'You’re fully verified — bookings and auditions are unlocked.' },
  rejected: { label: 'Rejected', desc: 'Your last submission was rejected. See the reason below and re-upload.' },
};

export default function VerificationScreen() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { kyc.myStatus().then(setStatus).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function handleUpload() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', imagePickerAssetToFormDataFile(result.assets[0]));
      formData.append('document_type', 'national_id');
      await kyc.uploadDocument(formData);
      load();
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDidit() {
    setError(null);
    setBusy(true);
    try {
      const { verification_url } = await kyc.startDiditSession();
      Linking.openURL(verification_url);
    } catch (err) {
      setError(err.message || 'Could not start Didit verification');
    } finally {
      setBusy(false);
    }
  }

  const copy = status ? STATUS_COPY[status.id_verification_status] : null;
  const variant = status ? badgeVariantForStatus(status.id_verification_status === 'verified' ? 'active' : status.id_verification_status) : null;

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Identity verification</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Every user must verify their identity before booking, teaching, or receiving a payout.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {copy && (
        <View style={[commonStyles.card, { borderLeftWidth: 4, borderLeftColor: variant?.fg }]}>
          <Text style={{ fontWeight: '700' }}>{copy.label}</Text>
          <Text style={{ marginTop: 4 }}>{copy.desc}</Text>
          {status.id_rejection_reason && <Text style={{ color: '#b91c1c', marginTop: 4 }}>Reason: {status.id_rejection_reason}</Text>}
        </View>
      )}

      {status && !['verified', 'pending'].includes(status.id_verification_status) && (
        <>
          <View style={commonStyles.card}>
            <Text style={{ fontWeight: '700', marginBottom: 4 }}>Quick verify with Didit</Text>
            <Text style={{ color: '#6b7280', marginBottom: spacing.sm }}>Complete a guided document + selfie check.</Text>
            <Pressable style={commonStyles.primaryButton} onPress={handleDidit} disabled={busy}>
              <Text style={commonStyles.primaryButtonText}>Start Didit verification</Text>
            </Pressable>
          </View>

          <View style={commonStyles.card}>
            <Text style={{ fontWeight: '700', marginBottom: 4 }}>Or upload a photo of your ID</Text>
            <Pressable style={commonStyles.secondaryButton} onPress={handleUpload} disabled={busy}>
              <Text style={commonStyles.secondaryButtonText}>{busy ? 'Uploading…' : 'Choose photo & upload'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}
