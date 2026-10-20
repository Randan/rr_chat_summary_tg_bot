import { buildTelegramFileUrl } from './telegram-file.util';

describe('buildTelegramFileUrl', () => {
  it('builds the Bot API file download URL', () => {
    expect(buildTelegramFileUrl('123:abc', 'voice/file_1.oga')).toBe(
      'https://api.telegram.org/file/bot123:abc/voice/file_1.oga',
    );
  });
});
