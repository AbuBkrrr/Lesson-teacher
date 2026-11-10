import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { skills } from '../api/client';
import { colors, spacing, typography, commonStyles } from '../theme';

const CATEGORY_LABELS = {
  academic: 'Academic', mental: 'Mental', physical: 'Physical',
  creative: 'Creative', life: 'Life Skills', career: 'Career',
};

export default function DiscoverSkillsScreen({ navigation }) {
  const [skillsByCategory, setSkillsByCategory] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [city, setCity] = useState('');
  const [online, setOnline] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    skills.list().then((d) => {
      const grouped = {};
      d.skills.forEach((s) => { (grouped[s.category] ||= []).push(s); });
      setSkillsByCategory(grouped);
    }).catch((e) => setError(e.message));
  }, []);

  function toggleSkill(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={styles.title}>What does your child need help with?</Text>
      <Text style={styles.subtitle}>Pick a few skills — we’ll find tutors who teach them.</Text>

      {error && (
        <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>
      )}

      {Object.entries(skillsByCategory).map(([category, list]) => (
        <View key={category} style={{ marginBottom: spacing.sm }}>
          <Text style={styles.categoryLabel}>{CATEGORY_LABELS[category] || category}</Text>
          <View style={styles.pillGroup}>
            {list.map((s) => {
              const isSelected = selected.has(s.id);
              return (
                <Pressable
                  key={s.id}
                  style={[styles.pill, isSelected && styles.pillSelected]}
                  onPress={() => toggleSkill(s.id)}
                >
                  <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                    {s.icon} {s.name} {isSelected ? '✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View style={commonStyles.field}>
        <Text style={commonStyles.label}>City (optional)</Text>
        <TextInput style={commonStyles.input} value={city} onChangeText={setCity} placeholder="e.g. Lagos" />
      </View>
      <View style={styles.pillGroup}>
        {[['', 'Online or in-person'], ['true', 'Online only'], ['false', 'In-person only']].map(([val, label]) => (
          <Pressable key={val} style={[styles.pill, online === val && styles.pillSelected]} onPress={() => setOnline(val)}>
            <Text style={[styles.pillText, online === val && styles.pillTextSelected]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[commonStyles.primaryButton, { marginTop: spacing.md }]}
        onPress={() => navigation.navigate('SwipeStage', { selectedSkillIds: [...selected], city, online })}
      >
        <Text style={commonStyles.primaryButtonText}>Find tutors →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.h1, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: typography.body, color: colors.muted, marginBottom: spacing.md },
  categoryLabel: { fontSize: typography.small, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  pillGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: spacing.md, paddingVertical: 8, backgroundColor: colors.card,
  },
  pillSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  pillText: { fontSize: typography.small, color: colors.text },
  pillTextSelected: { color: colors.primary, fontWeight: '700' },
});
