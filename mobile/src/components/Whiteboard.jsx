import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, spacing } from '../theme';

const COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#f59e0b'];
const ASPECT = 10 / 16; // same board shape as the desktop app, so normalised points line up

let seq = 0;
function newStrokeId() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 7)}`;
}

function toPath(points, w, h) {
  if (!points.length) return '';
  const [x0, y0] = points[0];
  let d = `M${x0 * w} ${y0 * h}`;
  if (points.length === 1) d += `L${x0 * w + 0.5} ${y0 * h + 0.5}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i][0] * w} ${points[i][1] * h}`;
  return d;
}

function strokeProps(s, w) {
  const scale = w / 800;
  if (s.tool === 'eraser') return { stroke: '#ffffff', strokeWidth: s.width * 4 * scale, opacity: 1 };
  return { stroke: s.color, strokeWidth: (s.tool === 'highlighter' ? s.width * 3 : s.width) * scale, opacity: s.tool === 'highlighter' ? 0.35 : 1 };
}

/** Shared whiteboard: draws `strokes`, calls onStroke(stroke) when a local stroke ends. */
export default function Whiteboard({ strokes, onStroke, onUndo, onClear, canClear }) {
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [live, setLive] = useState(null);
  const liveRef = useRef(null);
  const height = width * ASPECT;

  const pointAt = (e) => [
    Math.round(Math.min(Math.max(e.nativeEvent.locationX / width, 0), 1) * 10000) / 10000,
    Math.round(Math.min(Math.max(e.nativeEvent.locationY / height, 0), 1) * 10000) / 10000,
  ];
  const touch = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e) => {
      liveRef.current = { id: newStrokeId(), tool, color, width: 4, points: [pointAt(e)] };
      setLive({ ...liveRef.current });
    },
    onResponderMove: (e) => {
      const st = liveRef.current;
      if (!st || st.points.length >= 2000) return;
      const p = pointAt(e);
      const last = st.points[st.points.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.003) return;
      st.points.push(p);
      setLive({ ...st, points: [...st.points] });
    },
    onResponderRelease: () => {
      const st = liveRef.current;
      liveRef.current = null;
      setLive(null);
      if (st) onStroke(st);
    },
    onResponderTerminate: () => { liveRef.current = null; setLive(null); },
  };

  return (
    <View>
      <View style={styles.toolbar}>
        {['pen', 'highlighter', 'eraser'].map((t) => (
          <Pressable key={t} onPress={() => setTool(t)} style={[styles.tool, tool === t && styles.toolOn]} accessibilityRole="button" accessibilityState={{ selected: tool === t }}>
            <Text style={[styles.toolText, tool === t && { color: '#fff' }]}>{t[0].toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
        {COLORS.map((c) => (
          <Pressable key={c} onPress={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} accessibilityLabel={`Colour ${c}`}
            style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} />
        ))}
        <Pressable onPress={onUndo} style={styles.tool}><Text style={styles.toolText}>Undo</Text></Pressable>
        {canClear && <Pressable onPress={onClear} style={[styles.tool, { borderColor: '#991b1b' }]}><Text style={[styles.toolText, { color: '#991b1b' }]}>Clear</Text></Pressable>}
      </View>
      <View style={styles.board} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...touch}>
        {width > 0 && (
          <Svg width={width} height={height} pointerEvents="none">
            {[...strokes, ...(live ? [live] : [])].map((s) => (
              <Path key={s.id} d={toPath(s.points, width, height)} fill="none" strokeLinecap="round" strokeLinejoin="round" {...strokeProps(s, width)} />
            ))}
          </Svg>
        )}
        {width === 0 && <View style={{ aspectRatio: 1 / ASPECT }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: spacing.xs },
  tool: { borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  toolOn: { backgroundColor: colors.primary },
  toolText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
  swatchOn: { borderColor: colors.primary },
  board: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
});
