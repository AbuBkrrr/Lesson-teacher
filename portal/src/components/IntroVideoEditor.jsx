import React, { useRef, useState } from 'react';
import { tutors } from '../api/client';

const MAX_SECONDS = 120;
const MAX_MB = 50;

/** Reads a video file's duration in the browser (the server enforces the same limit on what we report). */
function readDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that video. Try an MP4 or MOV file.')); };
    v.src = url;
  });
}

/** Optional 1-2 minute intro video, shown under the bio. `profile` is the tutor profile row. */
export default function IntroVideoEditor({ profile, onChange }) {
  const input = useRef(null);
  const [picked, setPicked] = useState(null); // { file, duration, preview }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onPick(e) {
    setError(null);
    const file = e.target.files[0];
    setPicked(null);
    if (!file) return;
    if (!file.type.startsWith('video/')) return setError('Please choose a video file.');
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That file is over ${MAX_MB} MB. Try a shorter or lower-resolution clip.`);
    try {
      const duration = await readDuration(file);
      if (duration > MAX_SECONDS + 5) return setError(`That video is ${Math.round(duration)}s. Please keep it to 2 minutes or less.`);
      setPicked({ file, duration, preview: URL.createObjectURL(file) });
    } catch (err) {
      setError(err.message);
    }
  }

  async function upload() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', picked.file);
      fd.append('duration_seconds', String(Math.round(picked.duration)));
      const { profile: next } = await tutors.uploadIntroVideo(fd);
      onChange(next);
      setPicked(null);
      if (input.current) input.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await tutors.removeIntroVideo();
      onChange({ ...profile, intro_video_url: null, intro_video_duration_seconds: null });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lt-field" data-testid="intro-video-editor">
      <label htmlFor="intro-video-input">Introduction video <span style={{ fontWeight: 400, color: 'var(--lt-muted)' }}>(optional)</span></label>
      <p style={{ margin: 0, fontSize: '0.85rem' }}>
        A 1–2 minute clip of you describing your skills helps parents get to know you. Tutors with a video stand out in search.
      </p>
      {error && <div className="lt-error-banner" role="alert">{error}</div>}

      {profile.intro_video_url && !picked && (
        <>
          <video src={profile.intro_video_url} controls preload="metadata" playsInline style={{ width: '100%', maxHeight: 260, borderRadius: 10, background: '#000' }} />
          <div className="lt-row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--lt-muted)', fontSize: '0.85rem' }}>Current video{profile.intro_video_duration_seconds ? ` · ${profile.intro_video_duration_seconds}s` : ''}</span>
            <button type="button" className="lt-btn lt-btn--sm lt-btn--danger" onClick={remove} disabled={busy}>Remove video</button>
          </div>
        </>
      )}

      {picked && (
        <>
          <video src={picked.preview} controls playsInline style={{ width: '100%', maxHeight: 260, borderRadius: 10, background: '#000' }} />
          <div className="lt-row" style={{ gap: 8 }}>
            <span style={{ fontSize: '0.85rem' }}>{Math.round(picked.duration)}s · {(picked.file.size / 1048576).toFixed(1)} MB</span>
            <button type="button" className="lt-btn lt-btn--sm" onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload video'}</button>
          </div>
        </>
      )}

      <input id="intro-video-input" ref={input} type="file" accept="video/*" onChange={onPick} disabled={busy} />
    </div>
  );
}
