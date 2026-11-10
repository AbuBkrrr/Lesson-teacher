import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { lessonRequests } from '../api/client';
import { commonStyles, spacing } from '../theme';

export default function PostSearchScreen() {
  const [requests, setRequests] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { lessonRequests.mine().then((d) => setRequests(d.lesson_requests)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function handlePost() {
    if (!title.trim()) { setError('Title is required'); return; }
    setError(null);
    setBusy(true);
    try {
      await lessonRequests.create({ title, description, city, online });
      setTitle(''); setDescription(''); setCity('');
      load();
    } catch (err) {
      setError(err.message || 'Could not post request');
    } finally {
      setBusy(false);
    }
  }

  async function acceptApp(requestId, appId) {
    try { await lessonRequests.acceptApplication(requestId, appId); load(); } catch (err) { setError(err.message); }
  }
  async function declineApp(requestId, appId) {
    try { await lessonRequests.declineApplication(requestId, appId); load(); } catch (err) { setError(err.message); }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Post a search</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>Can&apos;t find the right tutor? Post what you need and let tutors apply to you.</Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      <View style={commonStyles.card}>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>What do you need help with?</Text>
          <TextInput style={commonStyles.input} value={title} onChangeText={setTitle} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Details (optional)</Text>
          <TextInput style={commonStyles.input} value={description} onChangeText={setDescription} multiline />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>City</Text>
          <TextInput style={commonStyles.input} value={city} onChangeText={setCity} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Switch value={online} onValueChange={setOnline} />
          <Text style={{ marginLeft: spacing.sm }}>Online is fine</Text>
        </View>
        <Pressable style={commonStyles.primaryButton} onPress={handlePost} disabled={busy}>
          <Text style={commonStyles.primaryButtonText}>{busy ? 'Posting…' : 'Post request'}</Text>
        </Pressable>
      </View>

      <Text style={{ fontSize: 16, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm }}>Your requests</Text>
      {requests.length === 0 && <Text style={commonStyles.emptyStateText}>You haven&apos;t posted any requests yet.</Text>}
      {requests.map((r) => (
        <View key={r.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '700' }}>{r.title} <Text style={{ color: '#6b7280' }}>({r.status})</Text></Text>
          {(r.applications || []).map((a) => (
            <View key={a.id} style={{ borderTopWidth: 1, borderTopColor: '#eee', paddingTop: spacing.xs, marginTop: spacing.xs }}>
              <Text style={{ fontWeight: '600' }}>{a.tutor_name} <Text style={{ color: '#6b7280' }}>({a.status})</Text></Text>
              {a.message ? <Text>{a.message}</Text> : null}
              {a.status === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Pressable style={commonStyles.primaryButton} onPress={() => acceptApp(r.id, a.id)}>
                    <Text style={commonStyles.primaryButtonText}>Accept</Text>
                  </Pressable>
                  <Pressable style={commonStyles.secondaryButton} onPress={() => declineApp(r.id, a.id)}>
                    <Text style={commonStyles.secondaryButtonText}>Decline</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
