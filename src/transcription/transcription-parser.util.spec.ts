import { parseTranscriptionBotText } from './transcription-parser.util';

describe('parseTranscriptionBotText', () => {
  it('joins the blockquote contents with blank lines', () => {
    expect(
      parseTranscriptionBotText('🎙 <b>Текст:</b><blockquote>перша</blockquote>\n<BLOCKQUOTE>друга</BLOCKQUOTE>'),
    ).toBe('перша\n\nдруга');
  });

  it('drops empty blockquotes', () => {
    expect(parseTranscriptionBotText('<blockquote> </blockquote><blockquote>текст</blockquote>')).toBe('текст');
  });

  it('strips the HTML of a text without blockquotes', () => {
    expect(parseTranscriptionBotText('  <i>просто</i> текст  ')).toBe('просто текст');
  });

  it('turns <br> into newlines and decodes HTML entities', () => {
    expect(
      parseTranscriptionBotText(
        '<blockquote>a<br>b<br/>c &amp; &lt;d&gt; &quot;e&quot; &#39;f&#39;&nbsp;g</blockquote>',
      ),
    ).toBe('a\nb\nc & <d> "e" \'f\' g');
  });
});
