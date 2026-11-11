import React, { useCallback, useEffect, useRef, useState } from 'react';

const COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'];
const WIDTHS = [2, 4, 8];
// Board keeps a fixed 16:10 aspect so normalised (0..1) coordinates map the
// same way on every participant's screen, whatever its size.
const ASPECT = 10 / 16;

function drawStroke(ctx, stroke, w, h) {
  if (!stroke.points.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const scale = w / 800; // widths are expressed for an 800px-wide board
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = stroke.width * 4 * scale;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
    ctx.lineWidth = (stroke.tool === 'highlighter' ? stroke.width * 3 : stroke.width) * scale;
  }
  ctx.beginPath();
  const [x0, y0] = stroke.points[0];
  ctx.moveTo(x0 * w, y0 * h);
  if (stroke.points.length === 1) ctx.lineTo(x0 * w + 0.1, y0 * h + 0.1);
  for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x * w, y * h);
  ctx.stroke();
  ctx.restore();
}

/**
 * Shared whiteboard. `strokes` is the authoritative list (owned by the
 * parent component and kept in sync over the socket); `onStroke` is called
 * with each finished stroke drawn locally.
 */
export default function Whiteboard({ strokes, onStroke, onUndo, onClear, canClear }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(240, Math.floor(entry.contentRect.width));
      setSize({ w, h: Math.floor(w * ASPECT) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    for (const s of strokes) drawStroke(ctx, s, size.w, size.h);
    if (drawingRef.current) drawStroke(ctx, drawingRef.current, size.w, size.h);
  }, [strokes, size]);

  useEffect(() => { redraw(); }, [redraw]);

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  }

  function onPointerDown(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawingRef.current = { id: crypto.randomUUID(), tool, color, width, points: [point(e)] };
    redraw();
  }
  function onPointerMove(e) {
    const s = drawingRef.current;
    if (!s || s.points.length >= 2000) return;
    const p = point(e);
    const last = s.points[s.points.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.002) return;
    s.points.push(p);
    const ctx = canvasRef.current.getContext('2d');
    drawStroke(ctx, { ...s, points: [last, p] }, size.w, size.h);
  }
  function onPointerUp() {
    const s = drawingRef.current;
    drawingRef.current = null;
    if (s) onStroke(s);
  }

  return (
    <div className="lt-wb">
      <div className="lt-wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
        {['pen', 'highlighter', 'eraser'].map((t) => (
          <button key={t} type="button" className={`lt-btn lt-btn--sm ${tool === t ? '' : 'lt-btn--secondary'}`} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span className="lt-wb-sep" />
        {COLORS.map((c) => (
          <button key={c} type="button" className={`lt-wb-swatch ${color === c ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} />
        ))}
        <span className="lt-wb-sep" />
        {WIDTHS.map((w) => (
          <button key={w} type="button" className={`lt-btn lt-btn--sm ${width === w ? '' : 'lt-btn--secondary'}`} aria-pressed={width === w} onClick={() => setWidth(w)}>
            {w === 2 ? 'Thin' : w === 4 ? 'Medium' : 'Thick'}
          </button>
        ))}
        <span className="lt-wb-sep" />
        <button type="button" className="lt-btn lt-btn--sm lt-btn--secondary" onClick={onUndo}>Undo</button>
        {canClear && <button type="button" className="lt-btn lt-btn--sm lt-btn--danger" onClick={onClear}>Clear board</button>}
      </div>
      <div ref={wrapRef} className="lt-wb-surface">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, touchAction: 'none' }}
          aria-label="Shared whiteboard"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
