const db = require('../config/db');
const { uuidv4 } = require('../utils/referral');
const { getEmailProvider } = require('./notificationProviders/email');
const { getSmsProvider } = require('./notificationProviders/sms');
const { getPushProvider } = require('./notificationProviders/push');

function now() {
  return new Date().toISOString();
}

async function recordNotification(userId, channel, type, subject, body, status) {
  await db.prepare(
    `INSERT INTO notifications (id, user_id, channel, type, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), userId, channel, type, subject || null, body, status, now());
}

/**
 * Sends to every contact method a user actually has on file — email
 * and/or SMS, whichever exist — rather than picking just one. A user with
 * neither is skipped silently (not an error): plenty of accounts in this
 * system are phone-only or email-only by design.
 */
async function notifyUser(user, { type, subject, body }) {
  const jobs = [];

  // In-app inbox entry: always written, so the user sees it even when email is
  // unverified, SMS fails or no push device is registered.
  jobs.push(recordNotification(user.id, 'in_app', type, subject, body, 'sent'));

  if (user.email) {
    jobs.push((async () => {
      let status = 'sent';
      try {
        await getEmailProvider().send({ to: user.email, subject, body });
      } catch (err) {
        status = 'failed';
        console.error(`[notifications] email send failed (type=${type}, user=${user.id})`, err.message);
      }
      await recordNotification(user.id, 'email', type, subject, body, status);
    })());
  }

  if (user.phone) {
    jobs.push((async () => {
      let status = 'sent';
      try {
        await getSmsProvider().send({ to: user.phone, body });
      } catch (err) {
        status = 'failed';
        console.error(`[notifications] sms send failed (type=${type}, user=${user.id})`, err.message);
      }
      await recordNotification(user.id, 'sms', type, null, body, status);
    })());
  }

  // Push goes to every device the user is signed into (a user may have
  // the app open on a phone and a tablet at once), unlike email/sms which
  // have exactly one destination on the user record.
  const pushTokens = await db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(user.id);
  for (const { token } of pushTokens) {
    jobs.push((async () => {
      let status = 'sent';
      try {
        await getPushProvider().send({ to: token, subject, body });
      } catch (err) {
        status = 'failed';
        console.error(`[notifications] push send failed (type=${type}, user=${user.id})`, err.message);
      }
      await recordNotification(user.id, 'push', type, subject, body, status);
    })());
  }

  await Promise.all(jobs);
}

// ---- Templates ----
// Kept as plain functions returning { subject, body } rather than a
// templating library — these are short, and every one of them is
// exercised by a test that checks the actual rendered text, so a
// mismatched placeholder fails loudly rather than silently.

const templates = {
  bookingRequested: (parentName, subject) => ({
    type: 'booking_requested',
    subject: 'New booking request',
    body: `${parentName} has requested a lesson with you${subject ? ` for ${subject}` : ''}. Log in to confirm or decline.`,
  }),
  bookingConfirmed: (tutorName, subject) => ({
    type: 'booking_confirmed',
    subject: 'Booking confirmed',
    body: `${tutorName} confirmed your booking${subject ? ` for ${subject}` : ''}. You can now pay for the session. If no time is set yet, agree one with ${tutorName} under Bookings → Set time.`,
  }),
  bookingRescheduled: (name, subject, iso) => ({
    type: 'booking_rescheduled',
    subject: 'Lesson time changed',
    body: `${name} set the lesson${subject ? ` for ${subject}` : ''} to ${new Date(iso).toUTCString()}.`,
  }),
  bookingDeclined: (tutorName) => ({
    type: 'booking_declined',
    subject: 'Booking request declined',
    body: `${tutorName} was unable to accept your booking request. Try browsing for another tutor.`,
  }),
  bookingCancelled: (otherPartyName, subject) => ({
    type: 'booking_cancelled',
    subject: 'Booking cancelled',
    body: `${otherPartyName} cancelled the booking${subject ? ` for ${subject}` : ''}.`,
  }),
  paymentReceipt: (tutorName, amount, currency) => ({
    type: 'payment_receipt',
    subject: 'Payment receipt',
    body: `Your payment of ${currency} ${amount} for your session with ${tutorName} was successful. Thank you.`,
  }),
  paymentReceived: (parentName, amount, currency) => ({
    type: 'payment_received',
    subject: 'You\u2019ve been paid',
    body: `${parentName} paid ${currency} ${amount} for their session with you. This has been added to your pending payout balance.`,
  }),
  directTransferProofUploaded: (parentName) => ({
    type: 'direct_transfer_proof_uploaded',
    subject: 'Proof of payment submitted',
    body: `${parentName} submitted proof of a direct bank transfer. Please confirm in your dashboard once you've verified you received it.`,
  }),
  assignmentCreated: (tutorName, title) => ({
    type: 'assignment_created',
    subject: 'New assignment',
    body: `${tutorName} sent a new assignment: "${title}". Log in to view the details.`,
  }),
  assignmentSubmitted: (studentName, title) => ({
    type: 'assignment_submitted',
    subject: 'Assignment submitted',
    body: `${studentName} submitted "${title}". Log in to review and grade it.`,
  }),
  idVerificationResult: (approved, reason) => ({
    type: approved ? 'id_verified' : 'id_rejected',
    subject: approved ? 'Your ID is verified' : 'ID verification needs attention',
    body: approved
      ? 'Your identity has been verified. You can now book lessons and request auditions.'
      : `We could not verify your ID: ${reason}. Open Verification and upload a new document.`,
  }),
  payoutSent: (amount, currency, status) => ({
    type: 'payout_sent',
    subject: status === 'paid' ? 'Payout sent' : 'Payout on its way',
    body: `A payout of ${currency} ${Number(amount).toLocaleString()} ${status === 'paid' ? 'has been sent to your bank account' : 'is being processed and will reach your bank account shortly'}.`,
  }),
  lessonCompleted: (tutorName, subject) => ({
    type: 'lesson_completed',
    subject: 'Lesson completed',
    body: `Your ${subject || 'lesson'} with ${tutorName} is complete. Open Bookings to leave a review.`,
  }),
  assignmentGraded: (tutorName, title, grade) => ({
    type: 'assignment_graded',
    subject: 'Assignment graded',
    body: `${tutorName} graded "${title}": ${grade}.`,
  }),
  refundRequestResolved: (status, resolution) => ({
    type: 'refund_request_resolved',
    subject: 'Update on your refund/reschedule request',
    body: status === 'denied'
      ? `Your ${resolution} request was reviewed and was not approved. Contact support if you have questions.`
      : `Your ${resolution} request was ${status}. Our team will follow up with next steps if needed.`,
  }),
  applicationAccepted: (requesterName, title) => ({
    type: 'application_accepted',
    subject: 'Your application was accepted',
    body: `${requesterName} accepted your application for "${title}" and a booking has been created. Log in to confirm it.`,
  }),
  applicationDeclined: (title) => ({
    type: 'application_declined',
    subject: 'Update on your application',
    body: `Your application for "${title}" was not selected this time. Keep browsing for other open requests.`,
  }),
  auditionReady: () => ({
    type: 'audition_ready',
    subject: 'Your audition video is ready',
    body: `The tutor you requested an audition from has uploaded their video. Log in to review it.`,
  }),
  auditionDeclined: () => ({
    type: 'audition_declined',
    subject: 'Audition request declined',
    body: `The tutor was unable to complete this audition request. Try browsing for another tutor.`,
  }),
  newMessage: (senderName) => ({
    type: 'new_message',
    subject: 'New message',
    body: `${senderName} sent you a new message. Log in to reply.`,
  }),
  newReviewReceived: (parentName, rating) => ({
    type: 'new_review_received',
    subject: 'You received a new review',
    body: `${parentName} left you a ${rating}-star review. Log in to see what they said.`,
  }),
  lessonStartingSoon: (otherPartyName, subject, scheduledAt) => {
    const when = new Date(scheduledAt);
    const timeStr = Number.isNaN(when.getTime())
      ? 'soon'
      : when.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return {
      type: 'lesson_starting_soon',
      subject: 'Your lesson starts soon',
      body: `Your lesson with ${otherPartyName}${subject ? ` (${subject})` : ''} starts at ${timeStr}. Log in a few minutes early to get set up.`,
    };
  },
  verifyEmail: (rawToken) => {
    const portalUrl = process.env.PORTAL_URL || 'http://localhost:5173';
    const link = `${portalUrl}/#/verify-email?token=${rawToken}`;
    return {
      type: 'verify_email',
      subject: 'Verify your email address',
      body: `Please confirm this is your email address by clicking the link below (expires in 24 hours): ${link}`,
    };
  },
  passwordReset: (rawToken) => {
    const portalUrl = process.env.PORTAL_URL || 'http://localhost:5173';
    const link = `${portalUrl}/#/reset-password?token=${rawToken}`;
    return {
      type: 'password_reset',
      subject: 'Reset your password',
      body: `Someone requested a password reset for this account. If this was you, reset it here (link expires in 1 hour): ${link}\n\nIf you didn't request this, you can ignore this message — your password hasn't changed.`,
    };
  },
};

module.exports = { notifyUser, templates };
