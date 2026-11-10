import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import Layout from '../components/Layout';
import { bookings } from '../api/client';
import { getSocket } from '../realtime/socket';
import { useAuth } from '../contexts/AuthContext';

/** Wraps a socket.emit(event, payload, ack) in a Promise and rejects on a server-side { ok: false } response. */
function call(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (result) => {
      if (result?.ok) resolve(result);
      else reject(new Error(result?.error || `${event} failed`));
    });
  });
}

export default function LessonRoom() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | in-call | ended | error
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remotePeers, setRemotePeers] = useState({}); // peerId -> { role, stream }

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const socketRef = useRef(null);
  const remoteStreamsRef = useRef({}); // peerId -> MediaStream, kept outside React state for imperative track attachment

  const attachRemoteTrack = useCallback((peerId, role, track) => {
    if (!remoteStreamsRef.current[peerId]) {
      remoteStreamsRef.current[peerId] = new MediaStream();
    }
    remoteStreamsRef.current[peerId].addTrack(track);
    setRemotePeers((prev) => ({ ...prev, [peerId]: { role, stream: remoteStreamsRef.current[peerId] } }));
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
    // The self-view <video> only mounts once status flips to 'in-call', but
    // the stream is captured earlier (while status is still 'connecting') —
    // so the direct assignment at capture time always misses a null ref.
    // Re-attach here once the element actually exists in the DOM.
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    socketRef.current = socket;

    async function start() {
      try {
        const bookingRes = await bookings.getOne(bookingId);
        if (cancelled) return;
        setBooking(bookingRes.booking);

        // Real camera/mic capture — this is the one part of the flow that
        // can't be exercised headlessly without a fake-device browser flag.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;

        const joinResult = await call(socket, 'lesson:join', bookingId);
        if (cancelled) return;

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
        deviceRef.current = device;

        // Send transport — carries this browser's own mic/camera out.
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

        // Recv transport — carries every other participant's media in.
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
          // Another connection for this same account took over this room
          // (e.g. the lesson was opened in a second tab) — this one is
          // now inert server-side, so leave gracefully rather than sit
          // in a broken state.
          setError('This lesson was opened in another tab or window.');
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
    const otherPartyPath = user?.role === 'tutor' ? '/tutor/bookings' : '/parent/bookings';
    navigate(otherPartyPath);
  }

  const otherPartyName = booking ? (user?.role === 'tutor' ? booking.parent_name : booking.tutor_name) : null;
  const remoteList = Object.entries(remotePeers);

  return (
    <Layout>
      <h1>Lesson{booking ? `: ${booking.subject || 'Session'}` : ''}</h1>
      {otherPartyName && <p>With {otherPartyName}</p>}

      {error && <div className="lt-error-banner">{error}</div>}

      {status === 'connecting' && <div className="lt-card lt-empty">Connecting to the call…</div>}

      {(status === 'in-call' || status === 'error') && (
        <div className="lt-lesson-room">
          <div className="lt-lesson-video-grid">
            {remoteList.length === 0 && status === 'in-call' && (
              <div className="lt-card lt-empty">Waiting for {otherPartyName || 'the other participant'} to join…</div>
            )}
            {remoteList.map(([peerId, { role, stream }]) => (
              <RemoteVideo key={peerId} stream={stream} label={role === 'tutor' ? 'Tutor' : 'Parent'} />
            ))}
          </div>

          <div className="lt-lesson-self-view">
            <video ref={localVideoRef} autoPlay muted playsInline className="lt-lesson-video" />
            <span className="lt-lesson-self-label">You</span>
          </div>

          <div className="lt-lesson-controls">
            <button className={`lt-btn ${micOn ? '' : 'lt-btn--danger'}`} onClick={toggleMic}>{micOn ? 'Mute' : 'Unmute'}</button>
            <button className={`lt-btn ${camOn ? '' : 'lt-btn--danger'}`} onClick={toggleCam}>{camOn ? 'Stop video' : 'Start video'}</button>
            <button className="lt-btn lt-btn--danger" onClick={leaveCall}>Leave</button>
          </div>
        </div>
      )}

      {status === 'ended' && (
        <div className="lt-card lt-empty">
          {error || 'The call has ended.'}
          <div style={{ marginTop: 12 }}>
            <button className="lt-btn" onClick={leaveCall}>Back to bookings</button>
          </div>
        </div>
      )}
    </Layout>
  );
}

function RemoteVideo({ stream, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="lt-lesson-remote-tile">
      <video ref={ref} autoPlay playsInline className="lt-lesson-video" />
      <span className="lt-lesson-self-label">{label}</span>
    </div>
  );
}
