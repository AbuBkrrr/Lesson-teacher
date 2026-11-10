import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, SafeAreaView } from 'react-native';
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
  const remoteStreamsRef = useRef({}); // peerId -> MediaStream (RN's, not the browser's)

  const attachRemoteTrack = useCallback((peerId, role, track) => {
    if (!remoteStreamsRef.current[peerId]) {
      // react-native-webrtc's MediaStream, not the DOM one — same
      // constructor name, different underlying native implementation.
      remoteStreamsRef.current[peerId] = new RNMediaStream();
    }
    remoteStreamsRef.current[peerId].addTrack(track);
    setRemotePeers((prev) => ({
      ...prev,
      [peerId]: { role, streamURL: remoteStreamsRef.current[peerId].toURL() },
    }));
  }, []);

  const removeRemotePeer = useCallback((peerId) => {
    delete remoteStreamsRef.current[peerId];
    setRemotePeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const consumeProducer = useCallback(async (socket, { peerId, role, producerId }) => {
    const recvTransport = recvTransportRef.current;
    const { params } = await call(socket, 'lesson:consume', {
      bookingId, transportId: recvTransport.id, producerId, rtpCapabilities: deviceRef.current.rtpCapabilities,
    });
    const consumer = await recvTransport.consume({
      id: params.id, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters,
    });
    attachRemoteTrack(peerId, role, consumer.track);
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

  const otherPartyName = booking ? (user?.role === 'tutor' ? booking.parent_name : booking.tutor_name) : null;
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
          {remoteList.map(([peerId, { role, streamURL }]) => (
            <View key={peerId} style={styles.remoteTile}>
              <RTCView streamURL={streamURL} style={styles.video} objectFit="cover" />
              <Text style={styles.tileLabel}>{role === 'tutor' ? 'Tutor' : 'Parent'}</Text>
            </View>
          ))}

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
  leaveBtn: { backgroundColor: colors.dangerFg },
  controlBtnText: { color: '#fff', fontWeight: '700', fontSize: typography.small },
});
