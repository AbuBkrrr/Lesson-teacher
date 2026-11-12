import React, { useEffect, useState } from 'react';
import { TextInput, View, Text, ScrollView, Pressable } from 'react-native';
import { skills } from '../api/client';
import { commonStyles, spacing, colors } from '../theme';

const CATEGORIES = ['academic', 'mental', 'physical', 'creative', 'life', 'career'];
const PROFICIENCIES = ['beginner', 'intermediate', 'advanced', 'expert'];

export default function TutorSkillsScreen() {
  const [catalog, setCatalog] = useState([]);
  const [mySkills, setMySkills] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [proficiency, setProficiency] = useState({});
  const [evidence, setEvidence] = useState({});

  function load() {
    skills.list().then((d) => setCatalog(d.skills)).catch((e) => setError(e.message));
    skills.mine().then((d) => setMySkills(d.tutor_skills)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const attachedIds = new Set(mySkills.map((s) => s.skill_id));

  async function attach(skillId) {
    setBusyId(skillId);
    setError(null);
    try {
      const links = (evidence[skillId] || '').split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
      await skills.addMine(skillId, proficiency[skillId] || 'intermediate', links);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function detach(skillId) {
    setBusyId(skillId);
    setError(null);
    try {
      await skills.removeMine(skillId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenContent}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: spacing.xs }}>My skills</Text>
      <Text style={{ color: '#6b7280', marginBottom: spacing.md }}>
        Parents filter tutors by skill when searching — attach the ones you teach, with your proficiency level.
      </Text>

      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      {CATEGORIES.map((cat) => {
        const items = catalog.filter((s) => s.category === cat);
        if (items.length === 0) return null;
        return (
          <View style={commonStyles.card} key={cat}>
            <Text style={{ fontSize: 16, fontWeight: '700', textTransform: 'capitalize', marginBottom: spacing.sm }}>{cat}</Text>
            {items.map((s) => {
              const attached = attachedIds.has(s.id);
              return (
                <View key={s.id} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ marginBottom: spacing.xs }}>{s.icon} {s.name}</Text>
                  {!attached && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
                      {PROFICIENCIES.map((p) => (
                        <Pressable
                          key={p}
                          style={[commonStyles.secondaryButton, { paddingVertical: 6, paddingHorizontal: spacing.sm }, (proficiency[s.id] || 'intermediate') === p && { backgroundColor: colors.primaryTint, borderColor: colors.primary }]}
                          onPress={() => setProficiency((p2) => ({ ...p2, [s.id]: p }))}
                        >
                          <Text style={commonStyles.secondaryButtonText}>{p}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {!attached && (
                    <TextInput
                      style={[commonStyles.input, { marginBottom: spacing.xs }]}
                      placeholder="Certificate / portfolio links (optional)"
                      autoCapitalize="none" keyboardType="url"
                      value={evidence[s.id] || ''}
                      onChangeText={(v) => setEvidence((e) => ({ ...e, [s.id]: v }))}
                      accessibilityLabel={`Evidence links for ${s.name}`}
                    />
                  )}
                  <Pressable
                    style={attached ? commonStyles.dangerButton : commonStyles.primaryButton}
                    disabled={busyId === s.id}
                    onPress={() => (attached ? detach(s.id) : attach(s.id))}
                  >
                    <Text style={attached ? commonStyles.dangerButtonText : commonStyles.primaryButtonText}>{attached ? 'Remove' : 'Add'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}
