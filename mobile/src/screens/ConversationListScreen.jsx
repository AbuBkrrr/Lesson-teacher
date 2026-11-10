import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { conversations } from '../api/client';
import { useFocusEffect } from '@react-navigation/native';
import { shortTime } from '../utils/time';
import { colors, spacing, typography, commonStyles } from '../theme';

export default function ConversationListScreen({ navigation }) {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    conversations.mine().then((d) => setList(d.conversations)).catch((e) => setError(e.message));
  }, []);

  useFocusEffect(load); // refresh previews/unread when returning from a thread

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={commonStyles.screen}>
      {error && <View style={[commonStyles.errorBanner, { margin: spacing.md }]}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No conversations yet.</Text></View>}
        renderItem={({ item: c }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('ConversationThread', { conversationId: c.id, tutorName: c.tutor_name })}
          >
            <View style={styles.line}>
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{c.tutor_name || c.child_name || c.parent_name || 'Conversation'}</Text>
              {c.last_message && <Text style={styles.time}>{shortTime(c.last_message.created_at)}</Text>}
            </View>
            <View style={styles.line}>
              <Text style={[styles.preview, { flex: 1 }]} numberOfLines={1}>{c.last_message ? `${c.last_message.mine ? 'You: ' : ''}${c.last_message.content}` : 'No messages yet'}</Text>
              {c.unread_count > 0 && <Text style={styles.badge}>{c.unread_count}</Text>}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { fontSize: 11, color: colors.muted },
  badge: { backgroundColor: colors.primary, color: '#fff', fontSize: 11, fontWeight: '700', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  name: { fontSize: typography.body, fontWeight: '700', color: colors.text },
  preview: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
});
