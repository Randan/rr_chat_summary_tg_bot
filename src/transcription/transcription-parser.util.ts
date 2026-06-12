const BLOCKQUOTE_PATTERN = /<blockquote>([\s\S]*?)<\/blockquote>/gi;

export function parseTranscriptionBotText(rawText: string): string {
  const matches = [...rawText.matchAll(BLOCKQUOTE_PATTERN)];
  if (matches.length === 0) {
    return stripHtml(rawText).trim();
  }

  const parts = matches.map(match => stripHtml(match[1]).trim()).filter(Boolean);
  return parts.join('\n\n');
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
