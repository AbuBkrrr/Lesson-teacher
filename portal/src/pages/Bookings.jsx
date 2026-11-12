import React, { useEffect, useState } from 'react';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { formatLesson, localInputToIso, isoToLocalInput, nowLocalInput, browserTimeZone } from '../utils/time';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import LessonReport from '../components/LessonReport';
import ConfirmButton from '../components/ConfirmButton';
import StatusBadge from '../components/StatusBadge';
import { bookings, payments, conversations, reviews, refundRequests } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const NEXT_ACTIONS = {
  tutor: { pending: [['confirmed', 'Confirm'], ['cancelled', 'Decline']], confirmed: [['completed', 'Mark completed'], ['cancelled', 'Cancel']] },
  parent: { pending: [['cancelled', 'Cancel']], confirmed: [['cancelled', 'Cancel']] },
};

const PAYMENT_METHODS = [
  { value: 'direct_transfer', label: 'Direct transfer' },
  { value: 'card', label: 'Card' },
  { value: 'ussd', label: 'USSD' },
  { value: 'gateway', label: 'Other (gateway)' },
];

export default function Bookings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [paymentsByBooking, setPaymentsByBooking] = useState({});
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [reviewedIds, setReviewedIds] = useState(new Set());

  useEffect(() => {
    if (['parent','adult_student'].includes(user?.role)) {
      reviews.mine().then((d) => setReviewedIds(new Set(d.reviews.map((r) => r.booking_id)))).catch(() => {});
    }
  }, [user]);

  // Inline panel (replaces window.prompt): one of review / refund open at a time.
  const [reportFor, setReportFor] = useState(null); // booking row
  const [panel, setPanel] = useState(null); // { kind: 'review'|'refund', bookingId }
  const [panelForm, setPanelForm] = useState({ rating: 5, comment: '', reason: '', resolution: 'refund', when: '' });
  const [notice, setNotice] = useState(null);

  function openPanel(kind, bookingId) {
    const current = rows.find((r) => r.id === bookingId)?.scheduled_at;
    setPanelForm({ rating: 5, comment: '', reason: '', resolution: 'refund', when: kind === 'schedule' ? isoToLocalInput(current) : '' });
    setPanel({ kind, bookingId });
  }

  async function submitPanel(e) {
    e.preventDefault();
    setError(null);
    try {
      if (panel.kind === 'schedule') {
        const iso = localInputToIso(panelForm.when);
        if (!iso) { setError('Pick a date and time.'); return; }
        await bookings.reschedule(panel.bookingId, iso);
        setNotice('Lesson time saved — the other person has been notified.');
        load();
      } else if (panel.kind === 'review') {
        await reviews.create({ booking_id: panel.bookingId, rating: Number(panelForm.rating), comment: panelForm.comment || undefined });
        setReviewedIds((prev) => new Set([...prev, panel.bookingId]));
        setNotice('Thanks for your review.');
      } else {
        await refundRequests.create({ booking_id: panel.bookingId, resolution: panelForm.resolution, reason: panelForm.reason });
        setNotice('Request submitted — our team will follow up.');
      }
      setPanel(null);
    } catch (err) {
      setError(err.message);
    }
  }

  // Method-picker step: which booking is currently choosing how to pay.
  const [methodPickerFor, setMethodPickerFor] = useState(null);

  // Mock-gateway "simulate payment" step (card/ussd/gateway with PAYMENT_PROVIDER=mock).
  const [pendingCheckout, setPendingCheckout] = useState(null);

  // Direct-transfer step: bank details shown + proof-of-payment upload.
  const [pendingTransfer, setPendingTransfer] = useState(null); // { bookingId, paymentId, instructions, amount, currency }
  const [proofFile, setProofFile] = useState(null);

  const load = () => {
    bookings.mine().then((d) => setRows(d.bookings)).catch((e) => setError(e.message));
    if (['parent','adult_student'].includes(user?.role) || user?.role === 'tutor') {
      payments.mine().then((d) => {
        const map = {};
        d.payments.forEach((p) => { map[p.booking_id] = p; });
        setPaymentsByBooking(map);
      }).catch(() => {});
    }
  };
  useEffect(load, [user?.role]);
  useRefreshOnFocus(load);

  async function updateStatus(id, status, opts) {
    setBusyId(id);
    setError(null);
    try {
      const res = await bookings.updateStatus(id, status, opts);
      if (res.skipped?.length) setError(`${res.updated_ids.length} lessons updated; ${res.skipped.length} skipped: ${res.skipped[0].reason}`);
      load();
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
          bookingId,
          paymentId: result.payment_id,
          instructions: result.transfer_instructions,
          amount: result.amount,
          currency: result.currency,
        });
      } else if (result.authorization_url?.startsWith('mock://')) {
        setPendingCheckout({ bookingId, reference: result.reference });
      } else {
        window.location.href = result.authorization_url;
      }
      setMethodPickerFor(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * A parent who opened the direct-transfer screen, saw the bank details,
   * but left before uploading proof (plausible — they need to go make the
   * actual transfer first) would otherwise hit a dead end: re-initializing
   * is correctly blocked while a payment is already pending, but there was
   * no way back to the details they were shown. This re-fetches them for
   * an already-existing pending payment instead of starting a new one.
   */
  async function resumeTransfer(bookingId, paymentId) {
    setBusyId(bookingId);
    setError(null);
    try {
      const result = await payments.getTransferDetails(paymentId);
      setPendingTransfer({
        bookingId,
        paymentId: result.payment_id,
        instructions: result.transfer_instructions,
        amount: result.amount,
        currency: result.currency,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function simulatePaymentComplete() {
    if (!pendingCheckout) return;
    setBusyId(pendingCheckout.bookingId);
    try {
      await payments.mockComplete(pendingCheckout.reference);
      setPendingCheckout(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitTransferProof() {
    if (!pendingTransfer || !proofFile) return;
    setBusyId(pendingTransfer.bookingId);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', proofFile);
      await payments.uploadProof(pendingTransfer.paymentId, formData);
      setPendingTransfer(null);
      setProofFile(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmTransfer(paymentId, bookingId) {
    setBusyId(bookingId);
    setError(null);
    try {
      await payments.confirm(paymentId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Parent messaging a booking's tutor is always a parent_tutor
   * conversation (no child_id sent). Tutor messaging a booking that
   * has a child attached opens/creates the child_tutor conversation
   * with that specific child instead.
   */
  async function startMessage(booking) {
    setBusyId(booking.id);
    setError(null);
    try {
      const payload = user?.role === 'tutor' && booking.child_id
        ? { tutor_id: booking.tutor_id, child_id: booking.child_id }
        : { tutor_id: booking.tutor_id };
      const result = await conversations.getOrCreate(payload);
      navigate('/messages', { state: { openConversationId: result.conversation.id } });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const otherPartyLabel = user?.role === 'tutor' ? 'Parent' : 'Tutor';
  const actions = NEXT_ACTIONS[user?.role] || {};
  const canMessage = (b) => b.status === 'confirmed' || b.status === 'completed';

  return (
    <Layout>
      <h1>Bookings</h1>
      <p>{user?.role === 'tutor' ? 'Sessions parents have requested with you.' : 'Sessions you have requested with tutors.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {notice && <div className="lt-success-banner" role="status">{notice}</div>}

      {panel && (
        <form className="lt-card" style={{ borderColor: 'var(--lt-primary)' }} onSubmit={submitPanel}>
          <h3>{{ review: 'Rate this lesson', schedule: 'Set the lesson time', refund: 'Request a refund or reschedule' }[panel.kind]}</h3>
          {panel.kind === 'schedule' ? (
            <div className="lt-field">
              <label htmlFor="panel-when">Date and time (one-hour lesson)</label>
              <input id="panel-when" type="datetime-local" min={nowLocalInput()} value={panelForm.when} onChange={(e) => setPanelForm((f) => ({ ...f, when: e.target.value }))} required />
              <span className="lt-helper-text">Your time zone: {browserTimeZone()}. The tutor's published hours and existing lessons are checked.</span>
            </div>
          ) : panel.kind === 'review' ? (
            <>
              <div className="lt-field">
                <label htmlFor="panel-rating">Rating</label>
                <select id="panel-rating" value={panelForm.rating} onChange={(e) => setPanelForm((f) => ({ ...f, rating: e.target.value }))}>
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}
                </select>
              </div>
              <div className="lt-field">
                <label htmlFor="panel-comment">Comment (optional)</label>
                <textarea id="panel-comment" rows={3} value={panelForm.comment} onChange={(e) => setPanelForm((f) => ({ ...f, comment: e.target.value }))} />
              </div>
            </>
          ) : (
            <>
              <div className="lt-field">
                <label htmlFor="panel-resolution">What would you like?</label>
                <select id="panel-resolution" value={panelForm.resolution} onChange={(e) => setPanelForm((f) => ({ ...f, resolution: e.target.value }))}>
                  <option value="refund">Refund</option>
                  <option value="reschedule">Reschedule</option>
                </select>
              </div>
              <div className="lt-field">
                <label htmlFor="panel-reason">Reason</label>
                <textarea id="panel-reason" rows={3} required value={panelForm.reason} onChange={(e) => setPanelForm((f) => ({ ...f, reason: e.target.value }))} />
              </div>
            </>
          )}
          <div className="lt-row">
            <button className="lt-btn" type="submit">Submit</button>
            <button className="lt-btn lt-btn--ghost" type="button" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {methodPickerFor && (
        <div className="lt-card" style={{ borderColor: 'var(--lt-primary)' }}>
          <h3>How would you like to pay?</h3>
          <div className="lt-row">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                className="lt-btn"
                disabled={busyId === methodPickerFor}
                onClick={() => startPayment(methodPickerFor, m.value)}
              >
                {m.label}
              </button>
            ))}
            <button className="lt-btn lt-btn--ghost" onClick={() => setMethodPickerFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {pendingCheckout && (
        <div className="lt-card" style={{ borderColor: 'var(--lt-primary)' }}>
          <h3>Complete payment</h3>
          <p>In production this redirects to the gateway's checkout page. In this dev environment, simulate completing it:</p>
          <div className="lt-row">
            <button className="lt-btn" disabled={busyId === pendingCheckout.bookingId} onClick={simulatePaymentComplete}>
              Simulate successful payment
            </button>
            <button className="lt-btn lt-btn--ghost" onClick={() => setPendingCheckout(null)}>Cancel</button>
          </div>
        </div>
      )}

      {pendingTransfer && (
        <div className="lt-card" style={{ borderColor: 'var(--lt-primary)' }}>
          <h3>Pay by direct transfer</h3>
          <p>
            Transfer <strong>{pendingTransfer.currency} {pendingTransfer.amount}</strong> to the account below, then upload
            your proof of payment. The tutor will confirm once they've received it.
          </p>
          <div className="lt-field-group" style={{ marginBottom: 16 }}>
            <div><strong>Bank:</strong> {pendingTransfer.instructions.bank_name}</div>
            <div><strong>Account number:</strong> {pendingTransfer.instructions.account_number}</div>
            <div><strong>Account name:</strong> {pendingTransfer.instructions.account_name}</div>
          </div>
          <div className="lt-field">
            <label htmlFor="bookings-f1">Proof of payment (screenshot or receipt)</label>
            <input id="bookings-f1" type="file" accept="image/*,.pdf" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
          </div>
          <div className="lt-row">
            <button
              className="lt-btn"
              disabled={busyId === pendingTransfer.bookingId || !proofFile}
              onClick={submitTransferProof}
            >
              Submit proof of payment
            </button>
            <button className="lt-btn lt-btn--ghost" onClick={() => { setPendingTransfer(null); setProofFile(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {reportFor && <LessonReport booking={reportFor} canEdit={user?.role === 'tutor'} onClose={() => setReportFor(null)} />}

      <div className="lt-card">
        <table className="lt-table">
          <thead>
            <tr><th>{otherPartyLabel}</th><th>Student</th><th>Subject</th><th>Scheduled</th><th>Status</th><th>Payment</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const payment = paymentsByBooking[b.id];
              const awaitingTutorConfirm = user?.role === 'tutor' && payment?.method === 'direct_transfer' && payment?.status === 'awaiting_confirmation';
              return (
                <tr key={b.id}>
                  <td data-label={otherPartyLabel}>{user?.role === 'tutor' ? b.parent_name : b.tutor_name}</td>
                  <td data-label="Student">{b.child_name || '—'}</td>
                  <td data-label="Subject">{b.subject || '—'}{b.duration_minutes && b.duration_minutes !== 60 ? ` (${b.duration_minutes} min)` : ''}{b.series_id && <div className="lt-helper-text">Weekly series</div>}</td>
                  <td data-label="Scheduled">{b.scheduled_at ? formatLesson(b.scheduled_at) : (['pending', 'confirmed'].includes(b.status) ? <span className="lt-helper-text">No time set</span> : '—')}</td>
                  <td data-label="Status"><StatusBadge status={b.status} /></td>
                  <td data-label="Payment">{payment ? <StatusBadge status={payment.status} /> : (['parent','adult_student'].includes(user?.role) ? '—' : '')}</td>
                  <td>
                    <div className="lt-row">
                      {['parent','adult_student'].includes(user?.role) && b.status === 'confirmed' && payment?.status !== 'successful' && payment?.status !== 'awaiting_confirmation'
                        && !(payment?.status === 'pending' && payment?.method === 'direct_transfer') && (
                        <button className="lt-btn lt-btn--sm" disabled={busyId === b.id} onClick={() => setMethodPickerFor(b.id)}>
                          Pay now
                        </button>
                      )}
                      {['parent','adult_student'].includes(user?.role) && payment?.status === 'pending' && payment?.method === 'direct_transfer' && (
                        <button className="lt-btn lt-btn--sm" disabled={busyId === b.id} onClick={() => resumeTransfer(b.id, payment.id)}>
                          Resume payment
                        </button>
                      )}
                      {awaitingTutorConfirm && (
                        <button className="lt-btn lt-btn--sm" disabled={busyId === b.id} onClick={() => confirmTransfer(payment.id, b.id)}>
                          Confirm payment received
                        </button>
                      )}
                      {['pending', 'confirmed'].includes(b.status) && ['parent', 'adult_student', 'tutor'].includes(user?.role) && (
                        <button className="lt-btn lt-btn--sm lt-btn--secondary" onClick={() => openPanel('schedule', b.id)}>{b.scheduled_at ? 'Reschedule' : 'Set time'}</button>
                      )}
                      {b.scheduled_at && ['pending', 'confirmed'].includes(b.status) && (
                        <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => bookings.downloadIcs(b.id).catch((e) => setError(e.message))}>Add to calendar</button>
                      )}
                      {b.status === 'confirmed' && payment?.status === 'successful' && (
                        <button className="lt-btn lt-btn--sm" onClick={() => navigate(`/lessons/${b.id}`)}>
                          Join lesson
                        </button>
                      )}
                      {['parent','adult_student'].includes(user?.role) && b.status === 'completed' && !reviewedIds.has(b.id) && (
                        <button className="lt-btn lt-btn--sm lt-btn--secondary" onClick={() => openPanel('review', b.id)}>Leave review</button>
                      )}
                      {['parent','adult_student'].includes(user?.role) && b.status === 'completed' && (
                        <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => openPanel('refund', b.id)}>Refund/reschedule</button>
                      )}
                      {['confirmed', 'completed'].includes(b.status) && (user?.role === 'tutor' || ['parent', 'adult_student'].includes(user?.role)) && (
                        <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => setReportFor(b)}>
                          {user?.role === 'tutor' ? 'Lesson report' : 'View report'}
                        </button>
                      )}
                      {b.series_id && user?.role === 'tutor' && b.status === 'pending' && (
                        <button className="lt-btn lt-btn--sm" disabled={busyId === b.id} onClick={() => updateStatus(b.id, 'confirmed', { apply_to_series: true })}>Confirm whole series</button>
                      )}
                      {b.series_id && ['pending', 'confirmed'].includes(b.status) && ['parent', 'adult_student', 'tutor'].includes(user?.role) && (
                        <ConfirmButton disabled={busyId === b.id} confirmLabel="Yes, cancel all" label="Cancel the rest of this weekly series"
                          onConfirm={() => updateStatus(b.id, 'cancelled', { apply_to_series: true })}>Cancel series</ConfirmButton>
                      )}
                      {canMessage(b) && (
                        <button className="lt-btn lt-btn--sm lt-btn--secondary" disabled={busyId === b.id} onClick={() => startMessage(b)}>
                          Message
                        </button>
                      )}
                      {(actions[b.status] || []).map(([next, label]) => (
                        next === 'cancelled' ? (
                          <ConfirmButton
                            key={next}
                            disabled={busyId === b.id}
                            confirmLabel={`Yes, ${label.toLowerCase()}`}
                            label={`${label} booking ${b.subject || ''}`.trim()}
                            onConfirm={() => updateStatus(b.id, next)}
                          >
                            {label}
                          </ConfirmButton>
                        ) : (
                          <button
                            key={next}
                            type="button"
                            className="lt-btn lt-btn--sm"
                            disabled={busyId === b.id}
                            onClick={() => updateStatus(b.id, next)}
                          >
                            {label}
                          </button>
                        )
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="lt-empty">No bookings yet — once a tutor accepts a request or you book a lesson, it shows up here.</div>}
      </div>
    </Layout>
  );
}
