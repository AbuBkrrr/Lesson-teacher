import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { curriculum, skills } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { commonStyles, spacing, typography, colors } from '../theme';
import { confirmAction } from '../utils/confirm';

export default function CurriculumScreen() {
  const { user } = useAuth();
  const canManage = user?.role === 'super_admin' || user?.role === 'school_admin';

  const [list, setList] = useState([]);
  const [skillOptions, setSkillOptions] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [skillId, setSkillId] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    curriculum.list().then((d) => setList(d.curriculum_units)).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    skills.list().then((d) => setSkillOptions(d.skills)).catch(() => {});
  }, []);

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await curriculum.create({ title, description, skill_id: skillId || undefined, grade_level: gradeLevel });
      setTitle(''); setDescription(''); setSkillId(''); setGradeLevel('');
      setSuccess('Curriculum unit added.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id) {
    setError(null);
    try {
      await curriculum.remove(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Curriculum</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        {user?.role === 'super_admin' && 'The global curriculum library, plus anything schools have added.'}
        {user?.role === 'school_admin' && "The global curriculum library, plus your own school's units."}
        {!canManage && 'Reference material for lesson planning.'}
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      {canManage && (
        <View style={commonStyles.card}>
          <Text style={styles.title}>Add a curriculum unit</Text>
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Title</Text>
            <TextInput style={commonStyles.input} value={title} onChangeText={setTitle} />
          </View>
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Description</Text>
            <TextInput style={commonStyles.input} value={description} onChangeText={setDescription} />
          </View>
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Skill (optional)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Pressable style={!skillId ? commonStyles.primaryButton : commonStyles.secondaryButton} onPress={() => setSkillId('')}>
                <Text style={!skillId ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>None</Text>
              </Pressable>
              {skillOptions.map((s) => (
                <Pressable key={s.id} style={skillId === s.id ? commonStyles.primaryButton : commonStyles.secondaryButton} onPress={() => setSkillId(s.id)}>
                  <Text style={skillId === s.id ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>{s.icon} {s.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={commonStyles.field}>
            <Text style={commonStyles.label}>Grade level</Text>
            <TextInput style={commonStyles.input} value={gradeLevel} onChangeText={setGradeLevel} placeholder="e.g. Primary 4" />
          </View>
          <Pressable style={[commonStyles.primaryButton, saving && commonStyles.buttonDisabled]} onPress={handleCreate} disabled={saving}>
            <Text style={commonStyles.primaryButtonText}>{saving ? 'Adding…' : 'Add unit'}</Text>
          </Pressable>
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: spacing.sm }}>
            {user?.role === 'super_admin' ? 'Added to the global library, visible to everyone.' : "Added to your school's own curriculum."}
          </Text>
        </View>
      )}

      <Text style={[styles.title, { marginTop: spacing.md }]}>Units</Text>
      {list.length === 0 && <Text style={commonStyles.emptyStateText}>No curriculum units yet.</Text>}
      {list.map((u) => (
        <View key={u.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '700' }}>{u.title}</Text>
          {u.description && <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>{u.description}</Text>}
          <Text style={{ fontSize: typography.small, color: colors.muted, marginTop: 2 }}>
            {u.skill_name ? `Skill: ${u.skill_name}` : 'No skill'} · {u.grade_level || 'Any grade'} ·{' '}
            {u.school_id ? (u.school_name || 'School') : 'Global'}
          </Text>
          {canManage && (
            <Pressable style={[commonStyles.dangerButton, { marginTop: spacing.sm, alignSelf: 'flex-start' }]} onPress={() => confirmAction('Remove this unit?', 'This cannot be undone.', () => handleRemove(u.id), 'Yes, remove')}>
              <Text style={commonStyles.dangerButtonText}>Remove</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
};
