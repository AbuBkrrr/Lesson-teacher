const { checkMessage } = require('../../src/services/contentFlagging');

describe('contentFlagging.checkMessage', () => {
  it('flags a message containing a phone number', () => {
    expect(checkMessage('call me at 555-123-4567')).toBeTruthy();
  });

  it('flags a request to move off-platform', () => {
    expect(checkMessage('message me on WhatsApp instead')).toBeTruthy();
  });

  it('flags a secrecy request', () => {
    expect(checkMessage("don't tell your parent about this")).toBeTruthy();
  });

  it('flags a request to meet in person', () => {
    expect(checkMessage('can you meet me in person after class')).toBeTruthy();
  });

  it('flags a request for personal info', () => {
    expect(checkMessage('where do you live exactly?')).toBeTruthy();
  });

  it('does not flag an ordinary lesson-related message', () => {
    expect(checkMessage('Great job on your fractions homework today!')).toBeNull();
  });

  it('does not flag an ordinary sentence about scheduling', () => {
    expect(checkMessage('See you at our next session on Thursday.')).toBeNull();
  });
});
