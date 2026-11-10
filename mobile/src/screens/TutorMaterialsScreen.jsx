import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { lessonMaterials, curriculum, imagePickerAssetToFormDataFile } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';
import { confirmAction } from '../utils/confirm';

export default function TutorMaterialsScreen() {
  const [list, setList] = useState([]);
  const [curriculumUnits, setCurriculumUnits] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [curriculumUnitId, setCurriculumUnitId] = useState('');
  const [file, setFile] = useState(null);

  function load() {
    lessonMaterials.mine().then((d) => setList(d.materials)).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    curriculum.list().then((d) => setCurriculumUnits(d.curriculum_units)).catch(() => {});
  }, []);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError('Photo library permission is needed.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    setFile(imagePickerAssetToFormDataFile(result.assets[0]));
  }

  async function handleUpload() {
    if (!file || !title.trim()) { setError('Title and a file are required.'); return; }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      if (description) fd.append('description', description);
      if (curriculumUnitId) fd.append('curriculum_unit_id', curriculumUnitId);
      await lessonMaterials.upload(fd);
      setTitle(''); setDescription(''); setCurriculumUnitId(''); setFile(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(id) {
    setError(null);
    try {
      await lessonMaterials.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Lesson materials</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Your content library — parents and students can see these once they have a confirmed booking with you.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      <View style={commonStyles.card}>
        <Text style={styles.title}>Upload material</Text>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Title</Text>
          <TextInput style={commonStyles.input} value={title} onChangeText={setTitle} />
        </View>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Description</Text>
          <TextInput style={commonStyles.input} value={description} onChangeText={setDescription} />
        </View>
        {curriculumUnits.length > 0 && (
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Curriculum unit (optional)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Pressable
                style={!curriculumUnitId ? commonStyles.primaryButton : commonStyles.secondaryButton}
                onPress={() => setCurriculumUnitId('')}
              >
                <Text style={!curriculumUnitId ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>None</Text>
              </Pressable>
              {curriculumUnits.map((u) => (
                <Pressable
                  key={u.id}
                  style={curriculumUnitId === u.id ? commonStyles.primaryButton : commonStyles.secondaryButton}
                  onPress={() => setCurriculumUnitId(u.id)}
                >
                  <Text style={curriculumUnitId === u.id ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>{u.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Pressable style={[commonStyles.secondaryButton, { marginBottom: spacing.sm }]} onPress={pickImage}>
          <Text style={commonStyles.secondaryButtonText}>Choose photo/file</Text>
        </Pressable>
        {file && <Text style={{ fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm }}>Selected: {file.name}</Text>}
        <Pressable style={[commonStyles.primaryButton, uploading && commonStyles.buttonDisabled]} onPress={handleUpload} disabled={uploading}>
          <Text style={commonStyles.primaryButtonText}>{uploading ? 'Uploading…' : 'Upload'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.title, { marginTop: spacing.md }]}>Your materials</Text>
      {list.length === 0 && <Text style={commonStyles.emptyStateText}>No materials uploaded yet.</Text>}
      {list.map((m) => (
        <View key={m.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '700' }}>{m.title}</Text>
          {m.description && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>{m.description}</Text>}
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2, textTransform: 'uppercase' }}>{m.file_type}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            {m.file_url && (
              <Pressable style={commonStyles.secondaryButton} onPress={() => Linking.openURL(m.file_url)}>
                <Text style={commonStyles.secondaryButtonText}>View</Text>
              </Pressable>
            )}
            <Pressable style={commonStyles.dangerButton} onPress={() => confirmAction('Remove this material?', 'Students will lose access to it.', () => handleRemove(m.id), 'Yes, remove')}>
              <Text style={commonStyles.dangerButtonText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
};
