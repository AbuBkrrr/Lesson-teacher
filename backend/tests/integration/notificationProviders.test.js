const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');

describe('SMTP email provider (against a local SMTP server)', () => {
  let server;
  let received;
  let authSeen;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: false,
      allowInsecureAuth: true,
      disabledCommands: ['STARTTLS'],
      onAuth(auth, session, cb) {
        authSeen = { user: auth.username, pass: auth.password };
        cb(null, { user: auth.username });
      },
      onData(stream, session, cb) {
        simpleParser(stream).then((mail) => { received = { mail, from: session.envelope.mailFrom.address, to: session.envelope.rcptTo.map((r) => r.address) }; cb(); });
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(server.server.address().port);
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASS = 's3cret';
    process.env.SMTP_FROM = 'Lesson Teacher <no-reply@lessonteacher.test>';
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('authenticates and delivers subject, body and addresses', async () => {
    const { send } = require('../../src/services/notificationProviders/email/smtpProvider');
    await send({ to: 'parent@example.com', subject: 'Reset your password', body: 'Click https://example.com/#/reset-password?token=abc' });
    expect(authSeen).toEqual({ user: 'mailer', pass: 's3cret' });
    expect(received.to).toEqual(['parent@example.com']);
    expect(received.from).toBe('no-reply@lessonteacher.test');
    expect(received.mail.subject).toBe('Reset your password');
    expect(received.mail.text).toContain('token=abc');
  });

  it('is selected by NOTIFICATION_EMAIL_PROVIDER=smtp and defaults to console', () => {
    const { getEmailProvider } = require('../../src/services/notificationProviders/email');
    process.env.NOTIFICATION_EMAIL_PROVIDER = 'smtp';
    expect(getEmailProvider().name).toBe('smtp');
    delete process.env.NOTIFICATION_EMAIL_PROVIDER;
    expect(getEmailProvider().name).toBe('console');
  });
});

describe('Twilio SMS provider (twilio client mocked)', () => {
  it('sends with the configured from number and fails clearly when config is missing', async () => {
    jest.resetModules();
    const create = jest.fn().mockResolvedValue({ sid: 'SM1' });
    jest.doMock('twilio', () => jest.fn(() => ({ messages: { create } })));
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    delete process.env.TWILIO_FROM_NUMBER;
    const { send } = require('../../src/services/notificationProviders/sms/twilioProvider');
    await expect(send({ to: '+2348000000000', body: 'hi' })).rejects.toThrow(/TWILIO_FROM_NUMBER/);
    process.env.TWILIO_FROM_NUMBER = '+15550001111';
    await send({ to: '+2348000000000', body: 'hi' });
    expect(create).toHaveBeenCalledWith({ to: '+2348000000000', from: '+15550001111', body: 'hi' });
  });
});
