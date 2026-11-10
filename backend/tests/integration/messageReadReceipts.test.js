const request = require('supertest');
const { getApp, signupParent, signupTutor, verifyUser } = require('../helpers');

const app = getApp();

async function confirmedParentTutorPair() {
  const { res: tutorRes } = await signupTutor(app);
  await verifyUser(tutorRes.body.user.id);
  const { res: parentRes } = await signupParent(app);
  await verifyUser(parentRes.body.user.id);

  const booking = await request(app).post('/api/bookings')
    .set('Authorization', `Bearer ${parentRes.body.access_token}`)
    .send({ tutor_id: tutorRes.body.user.id, subject: 'English' });
  await request(app).patch(`/api/bookings/${booking.body.booking.id}/status`)
    .set('Authorization', `Bearer ${tutorRes.body.access_token}`)
    .send({ status: 'confirmed' });

  const conv = await request(app).post('/api/conversations')
    .set('Authorization', `Bearer ${parentRes.body.access_token}`)
    .send({ tutor_id: tutorRes.body.user.id });

  return {
    conversationId: conv.body.conversation.id,
    tutorToken: tutorRes.body.access_token,
    parentToken: parentRes.body.access_token,
  };
}

describe('message read receipts and unread counts', () => {
  it('a conversation starts with one unread message for the recipient, and viewing it clears the count', async () => {
    const { conversationId, tutorToken, parentToken } = await confirmedParentTutorPair();

    await request(app).post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ content: 'Hi, are you free Tuesday?' });

    const tutorList = await request(app).get('/api/conversations/mine').set('Authorization', `Bearer ${tutorToken}`);
    expect(tutorList.body.conversations[0].unread_count).toBe(1);

    const tutorUnread = await request(app).get('/api/conversations/unread-count').set('Authorization', `Bearer ${tutorToken}`);
    expect(tutorUnread.body.unread).toBe(1);

    // Viewing the thread marks it read.
    await request(app).get(`/api/conversations/${conversationId}/messages`).set('Authorization', `Bearer ${tutorToken}`);

    const afterRead = await request(app).get('/api/conversations/mine').set('Authorization', `Bearer ${tutorToken}`);
    expect(afterRead.body.conversations[0].unread_count).toBe(0);
    const afterReadTotal = await request(app).get('/api/conversations/unread-count').set('Authorization', `Bearer ${tutorToken}`);
    expect(afterReadTotal.body.unread).toBe(0);
  });

  it('reports the other party\'s last_read_at as a "seen" receipt', async () => {
    const { conversationId, tutorToken, parentToken } = await confirmedParentTutorPair();

    await request(app).post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ content: 'Still there?' });

    // Before the tutor has opened the thread, the parent sees no read receipt.
    const beforeSeen = await request(app).get(`/api/conversations/${conversationId}/messages`).set('Authorization', `Bearer ${parentToken}`);
    expect(beforeSeen.body.other_read_at).toBeFalsy();

    await request(app).get(`/api/conversations/${conversationId}/messages`).set('Authorization', `Bearer ${tutorToken}`);

    const afterSeen = await request(app).get(`/api/conversations/${conversationId}/messages`).set('Authorization', `Bearer ${parentToken}`);
    expect(afterSeen.body.other_read_at).toBeTruthy();
  });

  it('a sender never counts their own messages as unread to themselves', async () => {
    const { conversationId, parentToken } = await confirmedParentTutorPair();
    await request(app).post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ content: 'Hello' });

    const mine = await request(app).get('/api/conversations/mine').set('Authorization', `Bearer ${parentToken}`);
    expect(mine.body.conversations[0].unread_count).toBe(0);
  });

  it('POST /:id/read marks a conversation read without needing to list messages', async () => {
    const { conversationId, tutorToken, parentToken } = await confirmedParentTutorPair();
    await request(app).post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ content: 'Ping' });

    const markRes = await request(app).post(`/api/conversations/${conversationId}/read`).set('Authorization', `Bearer ${tutorToken}`);
    expect(markRes.status).toBe(200);

    const unread = await request(app).get('/api/conversations/unread-count').set('Authorization', `Bearer ${tutorToken}`);
    expect(unread.body.unread).toBe(0);
  });
});
