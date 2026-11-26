import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView, ScrollView, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import Whiteboard from '../components/Whiteboard';
import { Device } from 'mediasoup-client';
import { mediaDevices, registerGlobals, RTCView, MediaStream as RNMediaStream } from 'react-native-webrtc';
import { bookings } from '../api/client';
import { getSocket } from '../realtime/socket';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, radius } from '../theme';

// mediasoup-client auto-detects its WebRTC handler by checking
// `navigator.product === 'ReactNative'` (a real check baked into
// mediasoup-client itself — see node_modules/mediasoup-client/lib/Device.js)
// and, when true, drives everything through the global RTCPeerConnection /
// MediaStream / etc. classes. Those globals don't exist until react-native
// -webrtc installs them — registerGlobals() has to run before any of this
// module's other code touches mediasoup-client or getUserMedia.
registerGlobals();

function call(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (result) => {
      if (result?.ok) resolve(result);
      else reject(new Error(result?.error || `${event} failed`));
    });
  });
}

export default function LessonRoomScreen({ route, navigation }) {
  const { bookingId } = route.params;
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStreamURL, setLocalStreamURL] = useState(null);
  const [remotePeers, setRemotePeers] = useState({}); // peerId -> { role, streamURL }

  const localStreamRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const socketRef = useRef(null);
  // tileKey -> MediaStream (react-native-webrtc's, not the DOM one). A screen
  // share from the desktop app gets its own tile: `${peerId}:screen`.
  const remoteStreamsRef = useRef({});
  const consumersRef = useRef({}); // consumerId -> { key, track, role, peerId, screen }
  const [panel, setPanel] = useState(null); // null | 'chat' | 'board'
  const [chat, setChat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [strokes, setStrokes] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const panelRef = useRef(null);
  useEffect(() => { panelRef.current = panel; }, [panel]);

  const publishTile = useCallback((key, meta) => {
    const stream = remoteStreamsRef.current[key];
    setRemotePeers((prev) => {
      const next = { ...prev };
      if (stream && stream.getTracks().length) next[key] = { ...meta, streamURL: stream.toURL() };
      else { delete next[key]; delete remoteStreamsRef.current[key]; }
      return next;
    });
  }, []);

  const attachRemoteTrack = useCallback((consumerId, peerId, role, track, source) => {
    const screen = source === 'screen';
    const key = screen ? `${peerId}:screen` : peerId;
    if (!remoteStreamsRef.current[key]) remoteStreamsRef.current[key] = new RNMediaStream();
    remoteStreamsRef.current[key].addTrack(track);
    consumersRef.current[consumerId] = { key, track, role, peerId, screen };
    publishTile(key, { role, peerId, screen });
  }, [publishTile]);

  const dropConsumer = useCallback((consumerId) => {
    const c = consumersRef.current[consumerId];
    if (!c) return;
    delete consumersRef.current[consumerId];
    remoteStreamsRef.current[c.key]?.removeTrack(c.track);
    publishTile(c.key, { role: c.role, peerId: c.peerId, screen: c.screen });
  }, [publishTile]);

  const removeRemotePeer = useCallback((peerId) => {
    for (const [id, c] of Object.entries(consumersRef.current)) if (c.peerId === peerId) delete consumersRef.current[id];
    for (const key of Object.keys(remoteStreamsRef.current)) if (key === peerId || key.startsWith(`${peerId}:`)) delete remoteStreamsRef.current[key];
    setRemotePeers((prev) => Object.fromEntries(Object.entries(prev).filter(([, t]) => t.peerId !== peerId)));
  }, []);

  const consumeProducer = useCallback(async (socket, { peerId, role, producerId, source }) => {
    const recvTransport = recvTransportRef.current;
    const { params } = await call(socket, 'lesson:consume', {
      bookingId, transportId: recvTransport.id, producerId, rtpCapabilities: deviceRef.current.rtpCapabilities,
    });
    const consumer = await recvTransport.consume({
      id: params.id, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters,
    });
    attachRemoteTrack(consumer.id, peerId, role, consumer.track, source);
    await call(socket, 'lesson:resume_consumer', { bookingId, consumerId: consumer.id });
  }, [bookingId, attachRemoteTrack]);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    socketRef.current = socket;

    async function start() {
      try {
        const bookingRes = await bookings.getOne(bookingId);
        if (cancelled) return;
        setBooking(bookingRes.booking);

        // react-native-webrtc's mediaDevices.getUserMedia — same call
        // shape as the browser API, backed by the phone's real camera/mic
        // through native code, not a simulation.
        const stream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStreamURL(stream.toURL());

        const joinResult = await call(socket, 'lesson:join', bookingId);
        setMyRole(joinResult.role);
        setChat(joinResult.chat || []);
        setStrokes(joinResult.whiteboard || []);
        if (cancelled) return;

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
        deviceRef.current = device;

        const sendParams = await call(socket, 'lesson:create_transport', { bookingId, direction: 'send' });
        const sendTransport = device.createSendTransport(sendParams.params);
        sendTransport.on('connect', ({ dtlsParameters }, cb, errCb) => {
          call(socket, 'lesson:connect_transport', { bookingId, transportId: sendTransport.id, dtlsParameters }).then(cb, errCb);
        });
        sendTransport.on('produce', ({ kind, rtpParameters }, cb, errCb) => {
          call(socket, 'lesson:produce', { bookingId, transportId: sendTransport.id, kind, rtpParameters })
            .then((res) => cb({ id: res.id }), errCb);
        });
        sendTransportRef.current = sendTransport;

        const recvParams = await call(socket, 'lesson:create_transport', { bookingId, direction: 'recv' });
        const recvTransport = device.createRecvTransport(recvParams.params);
        recvTransport.on('connect', ({ dtlsParameters }, cb, errCb) => {
          call(socket, 'lesson:connect_transport', { bookingId, transportId: recvTransport.id, dtlsParameters }).then(cb, errCb);
        });
        recvTransportRef.current = recvTransport;

        await sendTransport.produce({ track: stream.getAudioTracks()[0] });
        await sendTransport.produce({ track: stream.getVideoTracks()[0] });

        for (const p of joinResult.existingProducers) {
          await consumeProducer(socket, p);
        }

        socket.on('lesson:new_producer', (p) => consumeProducer(socket, p));
        socket.on('lesson:peer_left', ({ peerId }) => removeRemotePeer(peerId));
        socket.on('lesson:consumer_closed', ({ consumerId }) => dropConsumer(consumerId));
        socket.on('lesson:chat', (m) => {
          setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (panelRef.current !== 'chat') setUnread((n) => n + 1);
        });
        socket.on('lesson:wb_stroke', (st) => setStrokes((prev) => [...prev, st]));
        socket.on('lesson:wb_remove', ({ id }) => setStrokes((prev) => prev.filter((x) => x.id !== id)));
        socket.on('lesson:wb_cleared', () => setStrokes([]));
        socket.on('lesson:replaced', () => {
          setError('This lesson was opened on another device.');
          setStatus('ended');
        });

        if (!cancelled) setStatus('in-call');
      } catch (err) {
        if (!cancelled) {
          console.error('[lesson room] failed to start', err);
          setError(err.message || 'Could not start the call');
          setStatus('error');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      const socket = socketRef.current;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      if (socket) {
        socket.emit('lesson:leave', bookingId, () => {});
        socket.off('lesson:new_producer');
        socket.off('lesson:peer_left');
        for (const ev of ['lesson:consumer_closed', 'lesson:chat', 'lesson:wb_stroke', 'lesson:wb_remove', 'lesson:wb_cleared']) socket.off(ev);
        socket.off('lesson:replaced');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function toggleCam() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }

  function leaveCall() {
    navigation.goBack();
  }

  const otherPartyName = booking ? (user?.role === 'tutor' ? (booking.child_name || booking.parent_name) : booking.tutor_name) : null;

  function sendChat() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    call(socketRef.current, 'lesson:chat', { bookingId, text })
      .then(({ message }) => setChat((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message])))
      .catch((e) => { setDraft(text); setError(e.message); });
  }
  const sendStroke = useCallback((st) => {
    setStrokes((prev) => [...prev, st]);
    call(socketRef.current, 'lesson:wb_stroke', { bookingId, stroke: st }).catch((e) => {
      setStrokes((prev) => prev.filter((x) => x.id !== st.id));
      setError(e.message);
    });
  }, [bookingId]);
  function togglePanel(p) {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'chat') setUnread(0);
  }
  const remoteList = Object.entries(remotePeers);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{booking?.subject || 'Lesson'}</Text>
        {otherPartyName && <Text style={styles.subtitle}>With {otherPartyName}</Text>}
      </View>

      {error && (
        <View style={styles.errorBanner}><Text style={styles.errorBannerText}>{error}</Text></View>
      )}

      {status === 'connecting' && (
        <View style={styles.centeredMessage}><Text style={styles.mutedText}>Connecting to the call…</Text></View>
      )}

      {(status === 'in-call' || status === 'error') && (
        <View style={styles.callArea}>
          {remoteList.length === 0 && status === 'in-call' && (
            <View style={styles.centeredMessage}>
              <Text style={styles.mutedText}>Waiting for {otherPartyName || 'the other participant'} to join…</Text>
            </View>
          )}
          {remoteList.map(([key, { role, streamURL, screen }]) => (
            <View key={key} style={styles.remoteTile}>
              <RTCView streamURL={streamURL} style={styles.video} objectFit={screen ? 'contain' : 'cover'} />
              <Text style={styles.tileLabel}>{{ tutor: 'Tutor', parent: 'Parent', student: 'Student' }[role] || 'Participant'}{screen ? ' · screen' : ''}</Text>
            </View>
          ))}

          {panel && (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.panel}>
              {panel === 'chat' ? (
                <>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.sm }}>
                    {chat.length === 0 && <Text style={{ color: colors.muted }}>Messages here are saved with the lesson, and the parent can read them.</Text>}
                    {chat.map((m) => (
                      <View key={m.id} style={[styles.bubble, m.sender_id === user?.id && styles.bubbleMine]}>
                        <Text style={styles.bubbleWho}>{m.sender_id === user?.id ? 'You' : (m.sender_name || m.sender_role)}</Text>
                        <Text onPress={() => { const u = /(https?:\/\/\S+)/.exec(m.body)?.[1]; if (u) Linking.openURL(u); }}>{m.body}</Text>
                      </View>
                    ))}
                  </ScrollView>
                  <View style={styles.chatRow}>
                    <TextInput style={styles.chatInput} value={draft} onChangeText={setDraft} placeholder="Message or link" maxLength={1000}
                      onSubmitEditing={sendChat} returnKeyType="send" accessibilityLabel="Chat message" />
                    <Pressable style={[styles.controlBtn, { backgroundColor: colors.primary }]} onPress={sendChat}><Text style={styles.controlBtnText}>Send</Text></Pressable>
                  </View>
                </>
              ) : (
                <ScrollView contentContainerStyle={{ padding: spacing.sm }} scrollEnabled={false}>
                  <Whiteboard strokes={strokes} onStroke={sendStroke}
                    onUndo={() => call(socketRef.current, 'lesson:wb_undo', { bookingId }).catch((e) => setError(e.message))}
                    onClear={() => call(socketRef.current, 'lesson:wb_clear', { bookingId }).catch((e) => setError(e.message))}
                    canClear={myRole === 'tutor'} />
                </ScrollView>
              )}
            </KeyboardAvoidingView>
          )}

          {localStreamURL && (
            <View style={styles.selfView}>
              <RTCView streamURL={localStreamURL} style={styles.video} objectFit="cover" mirror zOrder={1} />
              <Text style={styles.tileLabel}>You</Text>
            </View>
          )}

          <View style={styles.controls}>
            <Pressable style={[styles.controlBtn, !micOn && styles.controlBtnActive]} onPress={toggleMic}>
              <Text style={styles.controlBtnText}>{micOn ? 'Mute' : 'Unmute'}</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, !camOn && styles.controlBtnActive]} onPress={toggleCam}>
              <Text style={styles.controlBtnText}>{camOn ? 'Stop video' : 'Start video'}</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, panel === 'chat' && styles.controlBtnOn]} onPress={() => togglePanel('chat')} accessibilityLabel="Chat">
              <Text style={styles.controlBtnText}>Chat{unread ? ` (${unread})` : ''}</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, panel === 'board' && styles.controlBtnOn]} onPress={() => togglePanel('board')} accessibilityLabel="Whiteboard">
              <Text style={styles.controlBtnText}>Board</Text>
            </Pressable>
            <Pressable style={[styles.controlBtn, styles.leaveBtn]} onPress={leaveCall}>
              <Text style={styles.controlBtnText}>Leave</Text>
            </Pressable>
          </View>
        </View>
      )}

      {status === 'ended' && (
        <View style={styles.centeredMessage}>
          <Text style={styles.mutedText}>{error || 'The call has ended.'}</Text>
          <Pressable style={[styles.controlBtn, { marginTop: spacing.md }]} onPress={leaveCall}>
            <Text style={styles.controlBtnText}>Back to bookings</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { padding: spacing.md },
  title: { fontSize: typography.h2, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: typography.small, color: '#ccc', marginTop: 2 },
  errorBanner: { backgroundColor: colors.dangerBg, margin: spacing.md, borderRadius: radius.sm, padding: spacing.sm },
  errorBannerText: { color: colors.dangerFg, fontSize: typography.small },
  centeredMessage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mutedText: { color: '#ccc' },
  callArea: { flex: 1, position: 'relative' },
  remoteTile: { flex: 1, backgroundColor: '#111' },
  video: { flex: 1 },
  tileLabel: {
    position: 'absolute', bottom: 8, left: 8, color: '#fff', fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
  },
  selfView: {
    position: 'absolute', bottom: 100, right: 16, width: 110, height: 150,
    borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#111',
    borderWidth: 2, borderColor: '#fff',
  },
  controls: {
    position: 'absolute', bottom: 24, alignSelf: 'center', flexDirection: 'row', gap: spacing.sm,
    backgroundColor: 'rgba(30,30,30,0.85)', borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  controlBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, backgroundColor: '#333' },
  controlBtnActive: { backgroundColor: colors.dangerFg },
  controlBtnOn: { backgroundColor: colors.primary },
  panel: { position: 'absolute', left: 8, right: 8, top: 8, bottom: 90, backgroundColor: '#fff', borderRadius: radius.md, overflow: 'hidden', zIndex: 5 },
  bubble: { backgroundColor: '#f0f2f5', borderRadius: 8, padding: 8, marginBottom: 6, maxWidth: '90%', alignSelf: 'flex-start' },
  bubbleMine: { backgroundColor: '#e0d7ff', alignSelf: 'flex-end' },
  bubbleWho: { fontSize: 11, fontWeight: '700', color: '#5b6270' },
  chatRow: { flexDirection: 'row', gap: 6, padding: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', alignItems: 'center' },
  chatInput: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  leaveBtn: { backgroundColor: colors.dangerFg },
  controlBtnText: { color: '#fff', fontWeight: '700', fontSize: typography.small },
});
