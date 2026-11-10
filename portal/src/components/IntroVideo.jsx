import React from 'react';

/** Tutor's optional self-introduction video, as shown on cards. Renders nothing without one. */
export default function IntroVideo({ url, name, style, ...rest }) {
  if (!url) return null;
  return (
    <video
      src={url}
      controls
      preload="none"
      playsInline
      {...rest}
      aria-label={`Introduction video from ${name || 'this tutor'}`}
      style={{ width: '100%', maxHeight: 240, borderRadius: 10, background: '#000', margin: '8px 0', ...style }}
    />
  );
}
