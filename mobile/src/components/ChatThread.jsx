import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Modal, Image, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { conversations, assetUrl } from '../api/client';
import { getSocket } from '../realtime/socket';
import { dayLabel } from '../utils/time';
import { useAuth } from '../contexts/AuthContext';
import { enqueueMessage, outboxFor, discardMessage, retryMessage, onOfflineEvent } from '../utils/offline';
import { colors, spacing, typography, radius, commonStyles } from '../theme';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const DISAPPEAR = [[0, 'Off'], [3600, '1 hour'], [86400, '24 hours'], [604800, '7 days']];
const isLive = (m) => !m.expires_at || Date.parse(m.expires_at) > Date.now();
const withinEditWindow = (m) => Date.now() - Date.parse(m.created_at) < 15 * 60 * 1000;

export default function ChatThread({ conversationId, otherPartyLabel = 'Them' }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [pending, setPending] = useState([]);
  const [typingUser, setTypingUser] = useState(false);
  const [editing, setEditing] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [presence, setPresence] = useState(null);
  const [sheet, setSheet] = useState(null); // message whose action sheet is open
  const [disappearOpen, setDisappearOpen] = useState(false);
  const [, setClock] = useState(0);
  const [uploading, setUploading] = useState(false);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);
  const lastTs = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const merge = (incoming) => setMessages((prev) => {
      const byId = new Map(incoming.map((m) => [m.id, m]));
      const updated = prev.map((m) => byId.get(m.id) || m); // edits/deletes replace in place
      const seen = new Set(prev.map((m) => m.id));
      const add = incoming.filter((m) => !seen.has(m.id));
      return add.length ? [...updated, ...add] : updated;
    });
    const track = (list) => { const last = list[list.length - 1]; if (last) lastTs.current = last.created_at; };

    conversations.messages(conversationId).then((d) => {
      if (cancelled) return;
      setMessages(d.messages);
      track(d.messages);
      setConversation(d.conversation);
      setOtherReadAt(d.other_read_at);
    }).catch((e) => setError(e.message));
    outboxFor(conversationId).then((p) => { if (!cancelled) setPending(p); });

    // Same socket events as the web client (join_conversation /
    // leave_conversation / new_message / conversation_read) — one wire protocol.
    const socket = getSocket();
    socket.emit('join_conversation', conversationId);
    const onNewMessage = (msg) => {
      if (msg.conversation_id !== conversationId) return;
      merge([msg]);
      track([msg]);
      if (msg.client_id) setPending((p) => p.filter((x) => x.client_id !== msg.client_id));
    };
    const onRead = (e) => { if (e.conversation_id === conversationId && e.user_id !== user?.id) setOtherReadAt(e.read_at); };
    const onReconnect = () => {
      socket.emit('join_conversation', conversationId);
      if (lastTs.current) conversations.messagesAfter(conversationId, lastTs.current).then((d) => { if (!cancelled) { merge(d.messages); track(d.messages); setOtherReadAt(d.other_read_at); } }).catch(() => {});
    };
    const onTyping = (e) => {
      if (e.conversation_id !== conversationId || e.user_id === user?.id) return;
      setTypingUser(!!e.typing);
      clearTimeout(typingTimer.current);
      if (e.typing) typingTimer.current = setTimeout(() => setTypingUser(false), 4000);
    };
    const onUpdated = (m) => { if (m.conversation_id === conversationId) merge([m]); };
    const onSettings = (e) => { if (e.conversation_id === conversationId) setConversation((c) => (c ? { ...c, disappear_after_seconds: e.disappear_after_seconds } : c)); };
    socket.on('conversation_settings', onSettings);
    socket.on('message_updated', onUpdated);
    const loadPresence = () => conversations.presence(conversationId).then((p) => { if (!cancelled) setPresence(p); }).catch(() => {});
    loadPresence();
    const presenceTimer = setInterval(loadPresence, 30000);
    const clockTimer = setInterval(() => setClock((c) => c + 1), 30000);
    socket.on('typing', onTyping);
    socket.on('new_message', onNewMessage);
    socket.on('conversation_read', onRead);
    socket.io.on('reconnect', onReconnect);
    const off = onOfflineEvent((e) => {
      if (e.type === 'sent') {
        if (e.message && e.message.conversation_id === conversationId) { merge([e.message]); track([e.message]); }
        setPending((p) => p.filter((x) => x.client_id !== e.client_id));
      } else if (e.type === 'failed') {
        setPending((p) => p.map((x) => (x.client_id === e.client_id ? { ...x, error: e.error } : x)));
      }
    });

    return () => {
      cancelled = true;
      clearInterval(presenceTimer);
      clearInterval(clockTimer);
      socket.off('conversation_settings', onSettings);
      socket.emit('leave_conversation', conversationId);
      socket.off('message_updated', onUpdated);
      socket.off('typing', onTyping);
      clearTimeout(typingTimer.current);
      socket.off('new_message', onNewMessage);
      socket.off('conversation_read', onRead);
      socket.io.off('reconnect', onReconnect);
      off();
    };
  }, [conversationId, user?.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length, pending.length]);

  const canSend = conversation
    ? conversation.kind === 'parent_tutor'
      ? ['parent', 'tutor', 'adult_student'].includes(user?.role)
      : ['child', 'tutor'].includes(user?.role) // child_tutor: parent is always read-only
    : false;

  // Always via the outbox: instant on screen, delivered when possible, never lost on a dropped connection.
  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    if (editing) {
      conversations.editMessage(conversationId, editing.id, text)
        .then((r) => { setMessages((prev) => prev.map((m) => (m.id === r.message.id ? r.message : m))); setEditing(null); setDraft(''); })
        .catch((err) => setError(err.message));
      return;
    }
    setDraft('');
    setError(null);
    getSocket().emit('typing', { conversationId, typing: false });
    lastTypingSent.current = 0;
    const m = await enqueueMessage(conversationId, text, replyTo?.id || null);
    setReplyTo(null);
    setPending((p) => [...p, m]);
  }

  async function pickAttachment() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    setUploading(true);
    conversations.sendAttachment(conversationId, res.assets[0], draft.trim(), replyTo?.id || null)
      .then((r) => { setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message])); setDraft(''); setReplyTo(null); })
      .catch((err) => setError(err.message))
      .finally(() => setUploading(false));
  }

  function react(m, emoji) {
    setSheet(null);
    const mine = m.reactions?.find((r) => r.user_id === user?.id);
    conversations.react(conversationId, m.id, mine?.emoji === emoji ? null : emoji)
      .then((r) => setMessages((prev) => prev.map((x) => (x.id === r.message.id ? r.message : x))))
      .catch((err) => setError(err.message));
  }

  function removeMessage(m) {
    setSheet(null);
    conversations.deleteMessage(conversationId, m.id)
      .then((r) => setMessages((prev) => prev.map((x) => (x.id === r.message.id ? r.message : x))))
      .catch((err) => setError(err.message));
  }

  function changeDisappear(secs) {
    setDisappearOpen(false);
    conversations.setDisappear(conversationId, secs).then((r) => setConversation(r.conversation)).catch((err) => setError(err.message));
  }

  function messageActions(m) {
    if (m.pending || m.deleted || !canSend) return;
    setSheet(m);
  }

  const lastSeen = presence?.online ? 'online' : presence?.last_seen_at ? `last seen ${dayLabel(presence.last_seen_at).toLowerCase()} at ${new Date(presence.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' ';
  const visible = messages.filter(isLive);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      {error && <View style={commonStyles.errorBanner}><Text style={commonStyles.errorBannerText}>{error}</Text></View>}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingRight: spacing.md }}>
        <Text style={styles.typingText}>{typingUser ? `${otherPartyLabel} is typing…` : lastSeen}</Text>
        {canSend && conversation?.kind === 'parent_tutor' && (
          <Pressable onPress={() => setDisappearOpen(true)}><Text style={styles.typingText}>{'\u23F3'} {DISAPPEAR.find(([v]) => v === (conversation.disappear_after_seconds || 0))?.[1] || 'Off'}</Text></Pressable>
        )}
      </View>
      <FlatList
        ref={listRef}
        data={[...visible, ...pending.map((p) => ({ ...p, id: `pending-${p.client_id}`, pending: true, sender_id: user?.id }))]}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No messages yet.</Text></View>}
        renderItem={({ item: m, index }) => {
          const all = [...visible, ...pending];
          const showDay = !m.pending && (index === 0 || new Date(m.created_at).toDateString() !== new Date(all[index - 1]?.created_at || 0).toDateString());
          const mine = m.sender_id === user?.id;
          const seen = mine && !m.pending && otherReadAt && otherReadAt >= m.created_at;
          return (
            <>
            {showDay && <Text style={styles.daySep}>{dayLabel(m.created_at)}</Text>}
            <View style={[styles.bubbleWrap, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
              <Pressable onLongPress={() => messageActions(m)} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, m.flagged ? styles.bubbleFlagged : null]}>
                {m.reply_to && !m.deleted && <Text style={[styles.quote, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]} numberOfLines={2}>{m.reply_to.deleted ? 'Deleted message' : m.reply_to.content}</Text>}
                {!m.deleted && m.attachment_url && (m.attachment_type || '').startsWith('image/') && (
                  <Pressable onPress={() => Linking.openURL(assetUrl(m.attachment_url))}><Image source={{ uri: assetUrl(m.attachment_url) }} style={{ width: 200, height: 200, borderRadius: 10, marginBottom: m.content ? 6 : 0 }} /></Pressable>
                )}
                {!m.deleted && m.attachment_url && !(m.attachment_type || '').startsWith('image/') && (
                  <Text style={[mine ? styles.bubbleTextMine : styles.bubbleTextTheirs, { textDecorationLine: 'underline' }]} onPress={() => Linking.openURL(assetUrl(m.attachment_url))}>{'\uD83D\uDCCE'} {m.attachment_name}</Text>
                )}
                <Text style={[mine ? styles.bubbleTextMine : styles.bubbleTextTheirs, m.deleted ? { fontStyle: 'italic', opacity: 0.7 } : null]}>
                  {m.deleted ? (mine ? 'You deleted this message' : 'This message was deleted') : m.content}
                </Text>
              </Pressable>
              {(m.reactions || []).length > 0 && (
                <Text style={styles.reactions}>{Object.entries((m.reactions || []).reduce((a, r) => ({ ...a, [r.emoji]: (a[r.emoji] || 0) + 1 }), {})).map(([e, n]) => `${e}${n > 1 ? ` ${n}` : ''}`).join('  ')}</Text>
              )}
              {m.flagged === 1 && <Text style={styles.flaggedText}>⚠ Flagged: {m.flag_reason}</Text>}
              {m.pending ? (
                m.error ? (
                  <Text style={[styles.timestampText, { color: colors.dangerFg }]}>
                    Not sent: {m.error} ·{' '}
                    <Text style={{ textDecorationLine: 'underline' }} onPress={() => { retryMessage(m.client_id); setPending((p) => p.map((x) => (x.client_id === m.client_id ? { ...x, error: null } : x))); }}>Retry</Text>
                    {' · '}
                    <Text style={{ textDecorationLine: 'underline' }} onPress={() => { discardMessage(m.client_id); setPending((p) => p.filter((x) => x.client_id !== m.client_id)); }}>Delete</Text>
                  </Text>
                ) : (
                  <Text style={styles.timestampText}>{'\u23F1'} Waiting to send…</Text>
                )
              ) : (
                <Text style={styles.timestampText}>
                  {m.edited && !m.deleted ? 'edited · ' : ''}{mine ? 'You' : otherPartyLabel} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {mine && <Text accessibilityLabel={seen ? 'Seen' : 'Sent'} style={{ color: seen ? colors.primary : colors.muted, fontWeight: '700' }}>{seen ? '  \u2713\u2713' : '  \u2713'}</Text>}
                </Text>
              )}
            </View>
            </>
          );
        }}
      />

      {!canSend ? (
        <Text style={styles.readOnlyText}>You’re viewing this conversation as a parent — read-only by design.</Text>
      ) : (
        <>
        {replyTo && <Text style={styles.typingText} onPress={() => setReplyTo(null)}>Replying to “{(replyTo.content || replyTo.attachment_name || 'attachment').slice(0, 50)}” — tap to cancel</Text>}
        {editing && <Text style={styles.typingText} onPress={() => { setEditing(null); setDraft(''); }}>Editing message — tap to cancel</Text>}
        <View style={styles.composerRow}>
          <Pressable onPress={pickAttachment} disabled={uploading || !!editing} accessibilityLabel="Attach a photo"><Text style={{ fontSize: 22, paddingHorizontal: 6 }}>{uploading ? '…' : '\uD83D\uDCCE'}</Text></Pressable>
          <TextInput
            style={styles.composerInput}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              const now = Date.now();
              if (now - lastTypingSent.current > 2500) { lastTypingSent.current = now; getSocket().emit('typing', { conversationId, typing: true }); }
            }}
            placeholder="Type a message…"
            multiline
          />
          <Pressable
            style={[commonStyles.primaryButton, styles.sendBtn, !draft.trim() && commonStyles.buttonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim()}
          >
            <Text style={commonStyles.primaryButtonText}>Send</Text>
          </Pressable>
        </View>
        </>
      )}

      <Modal transparent visible={!!sheet} animationType="fade" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
          <View style={styles.sheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm }}>
              {EMOJIS.map((e) => <Text key={e} style={{ fontSize: 28 }} onPress={() => react(sheet, e)}>{e}</Text>)}
            </View>
            <Text style={styles.sheetItem} onPress={() => { setReplyTo(sheet); setEditing(null); setSheet(null); }}>Reply</Text>
            {sheet && sheet.sender_id === user?.id && withinEditWindow(sheet) && !sheet.attachment_url && (
              <Text style={styles.sheetItem} onPress={() => { setEditing(sheet); setReplyTo(null); setDraft(sheet.content); setSheet(null); }}>Edit</Text>
            )}
            {sheet && sheet.sender_id === user?.id && <Text style={[styles.sheetItem, { color: colors.dangerFg }]} onPress={() => removeMessage(sheet)}>Delete for everyone</Text>}
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={disappearOpen} animationType="fade" onRequestClose={() => setDisappearOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDisappearOpen(false)}>
          <View style={styles.sheet}>
            <Text style={[styles.sheetItem, { fontWeight: '700' }]}>Disappearing messages</Text>
            {DISAPPEAR.map(([v, l]) => <Text key={v} style={styles.sheetItem} onPress={() => changeDisappear(v)}>{l}{(conversation?.disappear_after_seconds || 0) === v ? '  \u2713' : ''}</Text>)}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  quote: { fontSize: 12, opacity: 0.8, borderLeftWidth: 3, borderLeftColor: 'rgba(127,127,127,.6)', paddingLeft: 6, marginBottom: 4 },
  reactions: { fontSize: 14, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, padding: spacing.md, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetItem: { fontSize: 16, color: colors.text, paddingVertical: spacing.sm },
  typingText: { fontSize: 12, color: colors.primary, paddingHorizontal: spacing.md, minHeight: 16 },
  daySep: { alignSelf: 'center', backgroundColor: colors.background, color: colors.muted, fontSize: 11, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', marginVertical: spacing.xs },
  bubbleWrap: { maxWidth: '75%', marginBottom: spacing.sm },
  bubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.background },
  bubbleFlagged: { borderWidth: 2, borderColor: colors.dangerFg },
  bubbleTextMine: { color: '#fff' },
  bubbleTextTheirs: { color: colors.text },
  flaggedText: { fontSize: 11, color: colors.dangerFg, fontWeight: '700', marginTop: 2 },
  timestampText: { fontSize: 11, color: colors.muted, marginTop: 2 },
  readOnlyText: { padding: spacing.md, fontSize: typography.small, color: colors.muted },
  composerRow: { flexDirection: 'row', gap: spacing.xs, padding: spacing.md, alignItems: 'flex-end' },
  composerInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10, maxHeight: 100, backgroundColor: colors.card,
  },
  sendBtn: { paddingHorizontal: spacing.md },
});
