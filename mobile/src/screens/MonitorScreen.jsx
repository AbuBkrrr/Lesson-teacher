import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { conversations } from '../api/client';
import ChatThread from '../components/ChatThread';
import { colors, spacing, typography, commonStyles } from '../theme';

/**
 * Read-only by design — a parent can see every message between their
 * child and a tutor, automatically, without the child having to share
 * anything. ChatThread already renders as read-only for a parent viewing
 * a child_tutor conversation (see its canSend logic), so this screen
 * doesn't need any special-casing beyond picking which conversation to show.
 */
export default function MonitorScreen() {
  const [list, setList] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    conversations.monitor().then((d) => {
      setList(d.conversations);
      if (d.conversations.length > 0) setActiveId(d.conversations[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  const active = list.find((c) => c.id === activeId);

  if (activeId) {
    return (
      <View style={commonStyles.screen}>
        <Pressable style={styles.backRow} onPress={() => setActiveId(null)}>
          <Text style={styles.backText}>← All conversations</Text>
        </Pressable>
        <ChatThread conversationId={activeId} otherPartyLabel={active ? `${active.child_name} ↔ ${active.tutor_name}` : 'Conversation'} />
      </View>
    );
  }

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.screenContent}>
        <Text style={styles.intro}>
          Every conversation between your children and their tutors. You can read everything here — this is
          automatic, not something you have to remember to check.
        </Text>
      </View>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={commonStyles.screenContent}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No conversations to monitor yet.</Text></View>}
        renderItem={({ item: c }) => (
          <Pressable style={styles.row} onPress={() => setActiveId(c.id)}>
            <Text style={styles.rowText}>{c.child_name} ↔ {c.tutor_name}</Text>
            {c.flagged_count > 0 && (
              <View style={styles.flagBadge}><Text style={styles.flagBadgeText}>{c.flagged_count} flagged</Text></View>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: typography.small, color: colors.muted },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.border,
  },
  rowText: { fontSize: typography.body, color: colors.text, fontWeight: '600', flexShrink: 1 },
  flagBadge: { backgroundColor: colors.dangerBg, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  flagBadgeText: { color: colors.dangerFg, fontSize: 11, fontWeight: '700' },
  backRow: { padding: spacing.md },
  backText: { color: colors.primary, fontWeight: '600' },
});
