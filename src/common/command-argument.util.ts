import type { Context } from 'telegraf';

export function extractCommandNumericArgument(ctx: Context): number | undefined {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return undefined;
  }

  const messageText = message.text.trim();
  if ('entities' in message && Array.isArray(message.entities)) {
    const commandEntity = message.entities.find(entity => entity.type === 'bot_command');
    if (commandEntity) {
      const argumentText = messageText.slice(commandEntity.offset + commandEntity.length).trim();
      if (!argumentText) {
        return undefined;
      }

      const parsed = Number(argumentText.split(/\s+/)[0]);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
  }

  const parts = messageText.split(/\s+/);
  if (parts.length < 2) {
    return undefined;
  }

  const parsed = Number(parts[1]);
  return Number.isNaN(parsed) ? undefined : parsed;
}
