const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken } = require('../../src/utils/jwt');

describe('jwt utils', () => {
  const fakeUser = { id: 'user-123', role: 'parent', school_id: null };

  it('signs and verifies an access token round-trip', () => {
    const token = signAccessToken(fakeUser);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe(fakeUser.id);
    expect(payload.role).toBe('parent');
  });

  it('signs and verifies a refresh token round-trip', () => {
    const token = signRefreshToken(fakeUser);
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe(fakeUser.id);
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken(fakeUser);
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('hashToken is deterministic for the same input', () => {
    expect(hashToken('same-value')).toBe(hashToken('same-value'));
  });

  it('hashToken differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
