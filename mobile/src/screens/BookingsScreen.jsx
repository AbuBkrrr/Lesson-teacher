import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { bookings, payments, conversations, imagePickerAssetToFormDataFile, reviews, refundRequests } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, radius, commonStyles } from '../theme';
import { confirmAction } from '../utils/confirm';

const PAYMENT_METHODS = [
  { value: 'direct_transfer', label: 'Direct transfer' },
  { value: 'card', label: 'Card' },
  { value: 'ussd', label: 'USSD' },
  { value: 'gateway', label: 'Other (gateway)' },
];

// Mirrors the portal's NEXT_ACTIONS — the tutor side of a booking can
// confirm/decline a pending request and mark a confirmed one completed;
// parents can only cancel.
const NEXT_ACTIONS = {
  tutor: { pending: [['confirmed', 'Confirm'], ['cancelled', 'Decline']], confirmed: [['completed', 'Mark completed'], ['cancelled', 'Cancel']] },
  parent: { pending: [['cancelled', 'Cancel']], confirmed: [['cancelled', 'Cancel']] },
  adult_student: { pending: [['cancelled', 'Cancel']], confirmed: [['cancelled', 'Cancel']] },
};

export default function BookingsScreen({ navigation }) {
  const { user } = useAuth();
  const isParentLike = user?.role === 'parent' || user?.role === 'adult_student';
  const isTutor = user?.role === 'tutor';
  const actions = NEXT_ACTIONS[user?.role] || {};
  const [rows, setRows] = useState([]);
  const [paymentsByBooking, setPaymentsByBooking] = useState({});
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const [methodPickerFor, setMethodPickerFor] = useState(null);
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [reviewFor, setReviewFor] = useState(null); // bookingId
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [scheduleFor, setScheduleFor] = useState(null); // bookingId
  const [scheduleText, setScheduleText] = useState('');
  const [refundFor, setRefundFor] = useState(null); // bookingId
  const [refundReason, setRefundReason] = useState('');
  const [refundResolution, setRefundResolution] = useState('refund');
  const [reviewedIds, setReviewedIds] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const [bookingsRes, paymentsRes] = await Promise.all([bookings.mine(), payments.mine()]);
      setRows(bookingsRes.bookings);
      const map = {};
      paymentsRes.payments.forEach((p) => { map[p.booking_id] = p; });
      setPaymentsByBooking(map);
      reviews.mine().then((d) => setReviewedIds(new Set(d.reviews.map((r) => r.booking_id)))).catch(() => {});
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // This is the standard fetch-on-mount pattern (load() is also reused by
  // onRefresh below, which is why it's a stable useCallback rather than
  // inlined directly in the effect). The setState calls happen after an
  // await inside load(), not synchronously in the effect body — the
  // rule's static analysis can't see that distinction from the call site
  // alone.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function updateStatus(id, status) {
    setBusyId(id);
    setError(null);
    try {
      await bookings.updateStatus(id, status);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function startPayment(bookingId, method) {
    setBusyId(bookingId);
    setError(null);
    try {
      const result = await payments.initialize(bookingId, method);
      if (method === 'direct_transfer') {
        setPendingTransfer({
          bookingId, paymentId: result.payment_id, instructions: result.transfer_instructions,
          amount: result.amount, currency: result.currency,
        });
      } else if (result.authorization_url?.startsWith('mock://')) {
        // Dev-only path (PAYMENT_PROVIDER=mock) — a real gateway URL would
        // open in an in-app browser (expo-web-browser) instead.
        await payments.mockComplete(result.reference);
        await load();
      } else {
        // TODO(production): open result.authorization_url via
        // expo-web-browser's openAuthSessionAsync so the parent completes
        // checkout in-app and returns via a deep link, rather than leaving
        // the app entirely.
        setError('Gateway checkout needs expo-web-browser wired up — see the TODO in startPayment().');
      }
      setMethodPickerFor(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function pickProofAndUpload() {
    if (!pendingTransfer) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is needed to attach proof of payment.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled) return;

    setBusyId(pendingTransfer.bookingId);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', imagePickerAssetToFormDataFile(result.assets[0]));
      await payments.uploadProof(pendingTransfer.paymentId, formData);
      setPendingTransfer(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function startMessage(booking) {
    setBusyId(booking.id);
    setError(null);
    try {
      // A child's conversations with a tutor are scoped per-child on the backend
      // (kind: 'child_tutor') — child_id must be passed explicitly, it isn't
      // inferred from the signed-in user the way a parent's own id is.
      const payload = user?.role === 'child' ? { tutor_id: booking.tutor_id, child_id: booking.child_id } : { tutor_id: booking.tutor_id };
      const result = await conversations.getOrCreate(payload);
      navigation.navigate('Messages', { screen: 'ConversationThread', params: { conversationId: result.conversation.id, tutorName: booking.tutor_name } });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const canMessage = (b) => b.status === 'confirmed' || b.status === 'completed';

  async function submitReview() {
    if (!reviewRating) return;
    setBusyId(reviewFor);
    setError(null);
    try {
      await reviews.create({ booking_id: reviewFor, rating: reviewRating, comment: reviewComment || undefined });
      setReviewedIds((prev) => new Set([...prev, reviewFor]));
      setReviewFor(null);
      setReviewRating(0);
      setReviewComment('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  // Local wall-clock "YYYY-MM-DD HH:MM" (the phone's own time zone) -> UTC ISO.
  async function submitSchedule() {
    const m = scheduleText.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    if (!d || Number.isNaN(d.getTime())) { setError('Use the format YYYY-MM-DD HH:MM, e.g. 2026-11-03 16:00'); return; }
    if (d.getTime() < Date.now()) { setError('That time is in the past.'); return; }
    setBusyId(scheduleFor);
    setError(null);
    try {
      await bookings.reschedule(scheduleFor, d.toISOString());
      setScheduleFor(null);
      setScheduleText('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitRefundRequest() {
    if (!refundReason.trim()) return;
    setBusyId(refundFor);
    setError(null);
    try {
      await refundRequests.create({ booking_id: refundFor, resolution: refundResolution, reason: refundReason.trim() });
      setRefundFor(null);
      setRefundReason('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={commonStyles.screen}>
      {error && (
        <View style={[commonStyles.errorBanner, { margin: spacing.md, marginBottom: 0 }]}>
          <Text style={commonStyles.errorBannerText}>{error}</Text>
        </View>
      )}

      {methodPickerFor && (
        <View style={[commonStyles.card, styles.pickerCard]}>
          <Text style={styles.pickerTitle}>How would you like to pay?</Text>
          {PAYMENT_METHODS.map((m) => (
            <Pressable
              key={m.value}
              style={[commonStyles.secondaryButton, { marginBottom: spacing.xs }]}
              disabled={busyId === methodPickerFor}
              onPress={() => startPayment(methodPickerFor, m.value)}
            >
              <Text style={commonStyles.secondaryButtonText}>{m.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setMethodPickerFor(null)}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {pendingTransfer && (
        <View style={[commonStyles.card, styles.pickerCard]}>
          <Text style={styles.pickerTitle}>Pay by direct transfer</Text>
          <Text style={styles.transferText}>
            Transfer {pendingTransfer.currency} {pendingTransfer.amount} to the account below, then attach your
            proof of payment. The tutor will confirm once they’ve received it.
          </Text>
          <View style={styles.transferDetails}>
            <Text style={styles.transferDetailLine}>Bank: {pendingTransfer.instructions.bank_name}</Text>
            <Text style={styles.transferDetailLine}>Account number: {pendingTransfer.instructions.account_number}</Text>
            <Text style={styles.transferDetailLine}>Account name: {pendingTransfer.instructions.account_name}</Text>
          </View>
          <Pressable
            style={[commonStyles.primaryButton, { marginBottom: spacing.xs }]}
            disabled={busyId === pendingTransfer.bookingId}
            onPress={pickProofAndUpload}
          >
            <Text style={commonStyles.primaryButtonText}>Attach proof of payment</Text>
          </Pressable>
          <Pressable onPress={() => setPendingTransfer(null)}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {reviewFor && (
        <View style={[commonStyles.card, styles.pickerCard]}>
          <Text style={styles.pickerTitle}>Rate this lesson</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setReviewRating(n)}>
                <Text style={styles.star}>{n <= reviewRating ? '★' : '☆'}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[commonStyles.input, { marginBottom: spacing.sm }]}
            placeholder="Add a comment (optional)"
            value={reviewComment}
            onChangeText={setReviewComment}
          />
          <Pressable style={commonStyles.primaryButton} disabled={!reviewRating || busyId === reviewFor} onPress={submitReview}>
            <Text style={commonStyles.primaryButtonText}>Submit review</Text>
          </Pressable>
          <Pressable onPress={() => { setReviewFor(null); setReviewRating(0); setReviewComment(''); }}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {scheduleFor && (
        <View style={[commonStyles.card, styles.pickerCard]}>
          <Text style={styles.pickerTitle}>Set the lesson time</Text>
          <Text style={styles.metaText}>One-hour lesson, in your phone&apos;s time zone. Format: YYYY-MM-DD HH:MM</Text>
          <TextInput
            style={[commonStyles.input, { marginVertical: spacing.sm }]}
            placeholder="2026-11-03 16:00"
            value={scheduleText}
            onChangeText={setScheduleText}
            autoCapitalize="none"
          />
          <View style={styles.actionsRow}>
            <Pressable style={commonStyles.primaryButton} disabled={busyId === scheduleFor} onPress={submitSchedule}>
              <Text style={commonStyles.primaryButtonText}>Save time</Text>
            </Pressable>
            <Pressable style={commonStyles.secondaryButton} onPress={() => setScheduleFor(null)}>
              <Text style={commonStyles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {refundFor && (
        <View style={[commonStyles.card, styles.pickerCard]}>
          <Text style={styles.pickerTitle}>Refund or reschedule</Text>
          <View style={styles.actionsRow}>
            {['refund', 'reschedule'].map((opt) => (
              <Pressable
                key={opt}
                style={refundResolution === opt ? commonStyles.primaryButton : commonStyles.secondaryButton}
                onPress={() => setRefundResolution(opt)}
              >
                <Text style={refundResolution === opt ? commonStyles.primaryButtonText : commonStyles.secondaryButtonText}>
                  {opt === 'refund' ? 'Refund' : 'Reschedule'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[commonStyles.input, { marginTop: spacing.sm, marginBottom: spacing.sm }]}
            placeholder="Why are you requesting this?"
            value={refundReason}
            onChangeText={setRefundReason}
            multiline
          />
          <Pressable style={commonStyles.primaryButton} disabled={!refundReason.trim() || busyId === refundFor} onPress={submitRefundRequest}>
            <Text style={commonStyles.primaryButtonText}>Submit request</Text>
          </Pressable>
          <Pressable onPress={() => { setRefundFor(null); setRefundReason(''); }}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(b) => b.id}
        contentContainerStyle={commonStyles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}><Text style={commonStyles.emptyStateText}>No bookings yet.</Text></View>
        }
        renderItem={({ item: b }) => {
          const payment = paymentsByBooking[b.id];
          return (
            <View style={commonStyles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.tutorName}>{isTutor ? b.parent_name : b.tutor_name}</Text>
                <StatusBadge status={b.status} />
              </View>
              {b.child_name && <Text style={styles.metaText}>Student: {b.child_name}</Text>}
              <Text style={styles.metaText}>{b.subject || 'General tutoring'}</Text>
              {b.scheduled_at
                ? <Text style={styles.metaText}>{new Date(b.scheduled_at).toLocaleString()}</Text>
                : ['pending', 'confirmed'].includes(b.status) && <Text style={styles.metaText}>No time set yet</Text>}
              {payment && (
                <View style={[styles.rowBetween, { marginTop: spacing.xs }]}>
                  <Text style={styles.metaText}>Payment</Text>
                  <StatusBadge status={payment.status} />
                </View>
              )}

              <View style={styles.actionsRow}>
                {['pending', 'confirmed'].includes(b.status) && (
                  <Pressable style={commonStyles.secondaryButton} onPress={() => { setScheduleFor(b.id); setScheduleText(''); }}>
                    <Text style={commonStyles.secondaryButtonText}>{b.scheduled_at ? 'Reschedule' : 'Set time'}</Text>
                  </Pressable>
                )}
                {b.status === 'confirmed' && payment?.status === 'successful' && (
                  <Pressable style={commonStyles.primaryButton} onPress={() => navigation.navigate('LessonRoom', { bookingId: b.id })}>
                    <Text style={commonStyles.primaryButtonText}>Join lesson</Text>
                  </Pressable>
                )}
                {isParentLike && b.status === 'confirmed' && payment?.status !== 'successful' && payment?.status !== 'awaiting_confirmation' && (
                  <Pressable style={commonStyles.secondaryButton} disabled={busyId === b.id} onPress={() => setMethodPickerFor(b.id)}>
                    <Text style={commonStyles.secondaryButtonText}>Pay now</Text>
                  </Pressable>
                )}
                {canMessage(b) && (
                  <Pressable
                    style={commonStyles.secondaryButton}
                    disabled={busyId === b.id}
                    onPress={() => startMessage(b)}
                  >
                    <Text style={commonStyles.secondaryButtonText}>Message</Text>
                  </Pressable>
                )}
                {isParentLike && b.status === 'completed' && !reviewedIds.has(b.id) && (
                  <Pressable style={commonStyles.secondaryButton} onPress={() => setReviewFor(b.id)}>
                    <Text style={commonStyles.secondaryButtonText}>Leave review</Text>
                  </Pressable>
                )}
                {isParentLike && b.status === 'completed' && (
                  <Pressable style={commonStyles.secondaryButton} onPress={() => setRefundFor(b.id)}>
                    <Text style={commonStyles.secondaryButtonText}>Refund/reschedule</Text>
                  </Pressable>
                )}
                {(actions[b.status] || []).map(([next, label]) => (
                  <Pressable
                    key={next}
                    style={next === 'cancelled' ? commonStyles.dangerButton : commonStyles.primaryButton}
                    disabled={busyId === b.id}
                    onPress={() => (next === 'cancelled' ? confirmAction(`${label} this booking?`, 'The other person will be notified.', () => updateStatus(b.id, next), `Yes, ${label.toLowerCase()}`) : updateStatus(b.id, next))}
                  >
                    <Text style={next === 'cancelled' ? commonStyles.dangerButtonText : commonStyles.primaryButtonText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tutorName: { fontSize: typography.h2, fontWeight: '700', color: colors.text },
  metaText: { fontSize: typography.small, color: colors.muted, marginTop: 2 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  pickerCard: { margin: spacing.md, marginBottom: 0, borderColor: colors.primary },
  pickerTitle: { fontSize: typography.h2, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  transferText: { fontSize: typography.small, color: colors.text, marginBottom: spacing.sm },
  transferDetails: { backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  transferDetailLine: { fontSize: typography.small, color: colors.text, marginBottom: 2 },
  cancelLink: { textAlign: 'center', color: colors.muted, fontSize: typography.small, paddingVertical: spacing.xs },
  starsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  star: { fontSize: 32, color: colors.primary },
});
