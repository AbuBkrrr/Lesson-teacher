export function dayLabel(iso) {
  const d = new Date(iso); const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
export function shortTime(iso) {
  return dayLabel(iso) === 'Today' ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : dayLabel(iso);
}
