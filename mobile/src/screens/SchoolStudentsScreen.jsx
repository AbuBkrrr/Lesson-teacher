import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { schools } from '../api/client';
import { commonStyles, spacing, typography, colors } from '../theme';

export default function SchoolStudentsScreen() {
  const [students, setStudents] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [parentIdentifier, setParentIdentifier] = useState('');
  const [foundParent, setFoundParent] = useState(null);
  const [foundChildren, setFoundChildren] = useState([]);
  const [lookupError, setLookupError] = useState(null);
  const [fullName, setFullName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [saving, setSaving] = useState(null); // 'new' or a child id

  function load() {
    schools.children().then((d) => setStudents(d.children)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function handleLookup() {
    setLookupError(null);
    setFoundParent(null);
    setFoundChildren([]);
    try {
      const { parent, children } = await schools.lookupParent(parentIdentifier);
      setFoundParent(parent);
      setFoundChildren(children || []);
    } catch (err) {
      setLookupError(err.message);
    }
  }

  async function linkExistingChild(child) {
    setSaving(child.id);
    setError(null);
    setSuccess(null);
    try {
      await schools.addChild({ child_id: child.id });
      setSuccess(`${child.full_name} added to your roster.`);
      setFoundParent(null);
      setFoundChildren([]);
      setParentIdentifier('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  async function handleAddNewStudent() {
    if (!foundParent || !fullName) return;
    setSaving('new');
    setError(null);
    setSuccess(null);
    try {
      await schools.addChild({ parent_id: foundParent.id, full_name: fullName, grade_level: gradeLevel });
      setSuccess(`${fullName} added to your roster.`);
      setFullName(''); setGradeLevel('');
      setFoundParent(null);
      setFoundChildren([]);
      setParentIdentifier('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>Students</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Parents already need an account first — look them up by the email or phone they signed up with, then add their child to your roster.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      {success && <View style={[commonStyles.errorBanner, { backgroundColor: '#d1fae5' }]}><Text style={[commonStyles.errorBannerText, { color: '#065f46' }]}>{success}</Text></View>}

      <View style={commonStyles.card}>
        <Text style={styles.title}>Add a student</Text>
        <View style={commonStyles.field}>
          <Text style={commonStyles.label}>Parent&apos;s email or phone</Text>
          <TextInput style={commonStyles.input} value={parentIdentifier} onChangeText={setParentIdentifier} />
        </View>
        <Pressable style={commonStyles.secondaryButton} onPress={handleLookup}>
          <Text style={commonStyles.secondaryButtonText}>Look up</Text>
        </Pressable>
        {lookupError && <Text style={{ color: colors.dangerFg, marginTop: spacing.sm }}>{lookupError}</Text>}

        {foundParent && (
          <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <Text style={{ marginBottom: spacing.sm }}>Parent found: <Text style={{ fontWeight: '700' }}>{foundParent.full_name}</Text></Text>

            {foundChildren.length > 0 && (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={{ fontSize: typography.small, color: colors.muted, marginBottom: spacing.sm }}>
                  {foundParent.full_name} already has {foundChildren.length === 1 ? 'a child' : 'children'} in the
                  system — link the right one instead of creating a duplicate:
                </Text>
                {foundChildren.map((c) => (
                  <View key={c.id} style={[styles.rowBetween, { marginBottom: spacing.sm }]}>
                    <Text style={{ flex: 1 }}>
                      {c.full_name} {c.grade_level ? `(${c.grade_level})` : ''}{c.school_id ? ' — already linked to a school' : ''}
                    </Text>
                    <Pressable
                      style={[commonStyles.secondaryButton, (saving === c.id || !!c.school_id) && commonStyles.buttonDisabled]}
                      disabled={saving === c.id || !!c.school_id}
                      onPress={() => linkExistingChild(c)}
                    >
                      <Text style={commonStyles.secondaryButtonText}>{saving === c.id ? 'Linking…' : 'Link'}</Text>
                    </Pressable>
                  </View>
                ))}
                <Text style={{ fontSize: typography.small, color: colors.muted }}>None of these? Add a new one below.</Text>
              </View>
            )}

            <View style={commonStyles.field}>
              <Text style={commonStyles.label}>Student&apos;s full name</Text>
              <TextInput style={commonStyles.input} value={fullName} onChangeText={setFullName} />
            </View>
            <View style={commonStyles.field}>
              <Text style={commonStyles.label}>Grade level</Text>
              <TextInput style={commonStyles.input} value={gradeLevel} onChangeText={setGradeLevel} placeholder="e.g. Primary 4" />
            </View>
            <Pressable style={[commonStyles.primaryButton, saving === 'new' && commonStyles.buttonDisabled]} disabled={saving === 'new'} onPress={handleAddNewStudent}>
              <Text style={commonStyles.primaryButtonText}>{saving === 'new' ? 'Adding…' : 'Add as new student'}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Text style={[styles.title, { marginTop: spacing.md }]}>Roster</Text>
      {students.length === 0 && <Text style={commonStyles.emptyStateText}>No students on your roster yet.</Text>}
      {students.map((s) => (
        <View key={s.id} style={commonStyles.card}>
          <Text style={{ fontWeight: '600' }}>{s.full_name}</Text>
          <Text style={{ fontSize: typography.small, color: colors.muted }}>{s.grade_level || '—'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = {
  title: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
};
