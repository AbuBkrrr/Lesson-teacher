import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import Layout from '../components/Layout';
import Whiteboard from '../components/Whiteboard';
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

const ROLE_LABEL = { tutor: 'Tutor', parent: 'Parent', student: 'Student' };
const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export default function LessonRoom() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | in-call | ended | error
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [myRole, setMyRole] = useState(null);
  // tileKey (`${peerId}:${source}`) -> { peerId, role, source, stream }
  const [tiles, setTiles] = useState({});
  const [sharing, setSharing] = useState(false);
  const [panel, setPanel] = useState('chat'); // chat | board
  const [strokes, setStrokes] = useState([]);
  const [chat, setChat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const deviceRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const socketRef = useRef(null);
  const streamsRef = useRef({}); // tileKey -> MediaStream
  const consumersRef = useRef({}); // consumerId -> { consumer, tileKey }
  const screenProducerRef = useRef(null);
  const panelRef = useRef(panel);
  const chatEndRef = useRef(null);
  panelRef.current = panel;

  const publishTiles = useCallback((key, meta) => {
    setTiles((prev) => {
      const next = { ...prev };
      const stream = streamsRef.current[key];
      if (stream && stream.getTracks().length) next[key] = { ...meta, stream };
      else delete next[key];
      return next;
    });
  }, []);

  const attachRemoteTrack = useCallback((consumer, { peerId, role, source }) => {
    const tileSource = source === 'screen' ? 'screen' : 'camera'; // mic audio lives on the camera tile
    const key = `${peerId}:${tileSource}`;
    if (!streamsRef.current[key]) streamsRef.current[key] = new MediaStream();
    streamsRef.current[key].addTrack(consumer.track);
    consumersRef.current[consumer.id] = { consumer, key, meta: { peerId, role, source: tileSource } };
    publishTiles(key, { peerId, role, source: tileSource });
  }, [publishTiles]);

  const dropConsumer = useCallback((consumerId) => {
    const entry = consumersRef.current[consumerId];
    if (!entry) return;
    delete consumersRef.current[consumerId];
    streamsRef.current[entry.key]?.removeTrack(entry.consumer.track);
    entry.consumer.close();
    publishTiles(entry.key, entry.meta);
  }, [publishTiles]);

  const removeRemotePeer = useCallback((peerId) => {
    for (const [id, entry] of Object.entries(consumersRef.current)) {
      if (entry.meta.peerId === peerId) dropConsumer(id);
    }
    for (const key of Object.keys(streamsRef.current)) if (key.startsWith(`${peerId}:`)) delete streamsRef.current[key];
    setTiles((prev) => Object.fromEntries(Object.entries(prev).filter(([, t]) => t.peerId !== peerId)));
  }, [dropConsumer]);

  const consumeProducer = useCallback(async (socket, { peerId, role, producerId, source }) => {
    const recvTransport = recvTransportRef.current;
    const { params } = await call(socket, 'lesson:consume', {
      bookingId, transportId: recvTransport.id, producerId, rtpCapabilities: deviceRef.current.rtpCapabilities,
    });
    const consumer = await recvTransport.consume({
      id: params.id, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters,
    });
    attachRemoteTrack(consumer, { peerId, role, source });
    await call(socket, 'lesson:resume_consumer', { bookingId, consumerId: consumer.id });
  }, [bookingId, attachRemoteTrack]);

  useEffect(() => {
    // The self-view <video> only mounts once status flips to 'in-call', but
    // the stream is captured earlier — so re-attach once the element exists.
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [status]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chat, panel]);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    socketRef.current = socket;

    async function start() {
      try {
        const bookingRes = await bookings.getOne(bookingId);
        if (cancelled) return;
        setBooking(bookingRes.booking);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;

        const joinResult = await call(socket, 'lesson:join', bookingId);
        if (cancelled) return;
        setMyRole(joinResult.role);
        setStrokes(joinResult.whiteboard || []);
        setChat(joinResult.chat || []);

        const device = new Device();
        await device.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
        deviceRef.current = device;

        const sendParams = await call(socket, 'lesson:create_transport', { bookingId, direction: 'send' });
        const sendTransport = device.createSendTransport(sendParams.params);
        sendTransport.on('connect', ({ dtlsParameters }, cb, errCb) => {
          call(socket, 'lesson:connect_transport', { bookingId, transportId: sendTransport.id, dtlsParameters }).then(cb, errCb);
        });
        sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb, errCb) => {
          call(socket, 'lesson:produce', { bookingId, transportId: sendTransport.id, kind, rtpParameters, source: appData?.source })
            .then((res) => cb({ id: res.id }), errCb);
        });
        sendTransportRef.current = sendTransport;

        const recvParams = await call(socket, 'lesson:create_transport', { bookingId, direction: 'recv' });
        const recvTransport = device.createRecvTransport(recvParams.params);
        recvTransport.on('connect', ({ dtlsParameters }, cb, errCb) => {
          call(socket, 'lesson:connect_transport', { bookingId, transportId: recvTransport.id, dtlsParameters }).then(cb, errCb);
        });
        recvTransportRef.current = recvTransport;

        await sendTransport.produce({ track: stream.getAudioTracks()[0], appData: { source: 'mic' } });
        await sendTransport.produce({ track: stream.getVideoTracks()[0], appData: { source: 'camera' } });

        for (const p of joinResult.existingProducers) {
          await consumeProducer(socket, p);
        }

        socket.on('lesson:new_producer', (p) => consumeProducer(socket, p).catch((e) => console.error(e)));
        socket.on('lesson:consumer_closed', ({ consumerId }) => dropConsumer(consumerId));
        socket.on('lesson:peer_left', ({ peerId }) => removeRemotePeer(peerId));
        socket.on('lesson:wb_stroke', (s) => setStrokes((prev) => [...prev, s]));
        socket.on('lesson:wb_remove', ({ id }) => setStrokes((prev) => prev.filter((s) => s.id !== id)));
        socket.on('lesson:wb_cleared', () => setStrokes([]));
        socket.on('lesson:chat', (m) => {
          setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (panelRef.current !== 'chat') setUnread((n) => n + 1);
        });
        socket.on('lesson:replaced', () => {
          // Another connection for this account took over this room (e.g. a second tab).
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
      const s = socketRef.current;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenProducerRef.current?.track?.stop();
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      if (s) {
        s.emit('lesson:leave', bookingId, () => {});
        for (const ev of ['lesson:new_producer', 'lesson:consumer_closed', 'lesson:peer_left', 'lesson:replaced',
          'lesson:wb_stroke', 'lesson:wb_remove', 'lesson:wb_cleared', 'lesson:chat']) s.off(ev);
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

  async function stopShare() {
    const producer = screenProducerRef.current;
    screenProducerRef.current = null;
    setSharing(false);
    if (!producer) return;
    producer.track?.stop();
    producer.close();
    await call(socketRef.current, 'lesson:close_producer', { bookingId, producerId: producer.id }).catch(() => {});
  }

  async function startShare() {
    setNotice(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = display.getVideoTracks()[0];
      const producer = await sendTransportRef.current.produce({ track, appData: { source: 'screen' } });
      screenProducerRef.current = producer;
      setSharing(true);
      // The browser's own "Stop sharing" bar ends the track without telling us.
      track.addEventListener('ended', () => { if (screenProducerRef.current === producer) stopShare(); });
    } catch (err) {
      if (err?.name !== 'NotAllowedError') setNotice(err.message || 'Screen sharing failed');
    }
  }

  function sendStroke(stroke) {
    setStrokes((prev) => [...prev, stroke]);
    call(socketRef.current, 'lesson:wb_stroke', { bookingId, stroke }).catch((e) => {
      setStrokes((prev) => prev.filter((s) => s.id !== stroke.id));
      setNotice(e.message);
    });
  }
  function undoStroke() {
    call(socketRef.current, 'lesson:wb_undo', { bookingId }).catch((e) => setNotice(e.message));
  }
  function clearBoard() {
    if (!window.confirm('Clear the whiteboard for everyone?')) return;
    call(socketRef.current, 'lesson:wb_clear', { bookingId }).catch((e) => setNotice(e.message));
  }

  function sendChat(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    call(socketRef.current, 'lesson:chat', { bookingId, text })
      .then(({ message }) => setChat((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message])))
      .catch((err) => { setDraft(text); setNotice(err.message); });
  }

  function leaveCall() {
    const path = user?.role === 'tutor' ? '/tutor/bookings' : user?.role === 'child' ? '/messages' : '/parent/bookings';
    navigate(path);
  }

  function openPanel(p) {
    setPanel(p);
    if (p === 'chat') setUnread(0);
  }

  const otherPartyName = booking ? (user?.role === 'tutor' ? (booking.child_name || booking.parent_name) : booking.tutor_name) : null;
  const tileList = Object.entries(tiles).sort(([, a], [, b]) => (a.source === 'screen' ? -1 : 0) - (b.source === 'screen' ? -1 : 0));
  const someoneSharing = tileList.some(([, t]) => t.source === 'screen');

  return (
    <Layout>
      <h1>Lesson{booking ? `: ${booking.subject || 'Session'}` : ''}</h1>
      {otherPartyName && <p>With {otherPartyName}</p>}

      {error && <div className="lt-error-banner">{error}</div>}
      {notice && <div className="lt-error-banner" role="status">{notice} <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => setNotice(null)}>Dismiss</button></div>}

      {status === 'connecting' && <div className="lt-card lt-empty">Connecting to the call…</div>}

      {(status === 'in-call' || status === 'error') && (
        <div className="lt-lesson-room lt-lesson-layout">
          <div className="lt-lesson-stage">
            <div className={`lt-lesson-video-grid ${someoneSharing ? 'has-screen' : ''}`}>
              {tileList.length === 0 && status === 'in-call' && (
                <div className="lt-card lt-empty">Waiting for {otherPartyName || 'the other participant'} to join…</div>
              )}
              {tileList.map(([key, t]) => (
                <RemoteVideo key={key} stream={t.stream} screen={t.source === 'screen'}
                  label={`${ROLE_LABEL[t.role] || 'Participant'}${t.source === 'screen' ? ' · screen' : ''}`} />
              ))}
            </div>
          </div>

          <aside className="lt-lesson-side lt-card" aria-label="Lesson tools">
            <div className="lt-lesson-tabs" role="tablist">
              <button role="tab" aria-selected={panel === 'chat'} className={`lt-btn lt-btn--sm ${panel === 'chat' ? '' : 'lt-btn--secondary'}`} onClick={() => openPanel('chat')}>
                Chat{unread ? ` (${unread})` : ''}
              </button>
              <button role="tab" aria-selected={panel === 'board'} className={`lt-btn lt-btn--sm ${panel === 'board' ? '' : 'lt-btn--secondary'}`} onClick={() => openPanel('board')}>
                Whiteboard
              </button>
            </div>

            {panel === 'chat' && (
              <div className="lt-lesson-chat">
                <div className="lt-lesson-chat-log" aria-live="polite">
                  {chat.length === 0 && <p className="lt-muted">Messages sent here are saved with the lesson, and the parent can read them.</p>}
                  {chat.map((m) => (
                    <div key={m.id} className={`lt-lesson-chat-msg ${m.sender_id === user?.id ? 'is-mine' : ''}`}>
                      <span className="lt-lesson-chat-who">{m.sender_id === user?.id ? 'You' : (m.sender_name || ROLE_LABEL[m.sender_role])}</span>
                      <span className="lt-lesson-chat-body">{linkify(m.body)}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form className="lt-lesson-chat-form" onSubmit={sendChat}>
                  <input className="lt-field" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000}
                    placeholder="Message, or paste a link to share material" aria-label="Chat message" />
                  <button className="lt-btn lt-btn--sm" type="submit" disabled={!draft.trim()}>Send</button>
                </form>
              </div>
            )}
          </aside>

          {panel === 'board' && (
            <div className="lt-lesson-board lt-card">
              <Whiteboard strokes={strokes} onStroke={sendStroke} onUndo={undoStroke} onClear={clearBoard} canClear={myRole === 'tutor'} />
            </div>
          )}

          <div className="lt-lesson-self-view">
            <video ref={localVideoRef} autoPlay muted playsInline className="lt-lesson-video" />
            <span className="lt-lesson-self-label">You</span>
          </div>

          <div className="lt-lesson-controls">
            <button className={`lt-btn ${micOn ? '' : 'lt-btn--danger'}`} onClick={toggleMic}>{micOn ? 'Mute' : 'Unmute'}</button>
            <button className={`lt-btn ${camOn ? '' : 'lt-btn--danger'}`} onClick={toggleCam}>{camOn ? 'Stop video' : 'Start video'}</button>
            {canShareScreen && (
              <button className={`lt-btn ${sharing ? 'lt-btn--danger' : 'lt-btn--secondary'}`} onClick={sharing ? stopShare : startShare}>
                {sharing ? 'Stop sharing' : 'Share screen'}
              </button>
            )}
            <button className="lt-btn lt-btn--danger" onClick={leaveCall}>Leave</button>
          </div>
        </div>
      )}

      {status === 'ended' && (
        <div className="lt-card lt-empty">
          {error || 'The call has ended.'}
          <div style={{ marginTop: 12 }}>
            <button className="lt-btn" onClick={leaveCall}>Back</button>
          </div>
        </div>
      )}
    </Layout>
  );
}

/** Turns https links in chat into clickable links (opened outside the app). */
function linkify(text) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}

function RemoteVideo({ stream, label, screen }) {
  const ref = useRef(null);
  const [needsSound, setNeedsSound] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    v.muted = false;
    // Browsers block unmuted autoplay when the page was opened without a
    // click (e.g. straight from a notification link). Fall back to muted
    // playback so the picture still shows, and offer a button for sound.
    v.play().catch(() => {
      v.muted = true;
      setNeedsSound(true);
      v.play().catch(() => {});
    });
  }, [stream]);
  function enableSound() {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    v.play().then(() => setNeedsSound(false)).catch(() => { v.muted = true; });
  }
  return (
    <div className={`lt-lesson-remote-tile ${screen ? 'is-screen' : ''}`}>
      <video ref={ref} autoPlay playsInline className="lt-lesson-video" style={screen ? { objectFit: 'contain' } : undefined} />
      <span className="lt-lesson-self-label">{label}</span>
      {needsSound && !screen && (
        <button type="button" className="lt-btn lt-btn--sm lt-lesson-sound-btn" onClick={enableSound}>Turn on sound</button>
      )}
    </div>
  );
}
