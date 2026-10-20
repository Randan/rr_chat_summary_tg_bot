import { buildSummaryUserPrompt } from './summary-prompt.util';

describe('buildSummaryUserPrompt', () => {
  it('puts the period, the analyzed info, the language rule and the dialogue in order', () => {
    expect(
      buildSummaryUserPrompt({
        periodLabel: 'останні 5 повідомлень',
        analyzedInfo: 'Проаналізовано 5 повідомлень.',
        dialogue: 'Іван: привіт',
      }),
    ).toBe(
      [
        'Період аналізу: останні 5 повідомлень',
        'Проаналізовано 5 повідомлень.',
        '',
        'Склади підсумок виключно українською мовою.',
        '',
        'Лог чату:',
        'Іван: привіт',
      ].join('\n'),
    );
  });
});
