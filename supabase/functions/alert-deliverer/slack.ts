export interface SlackPayload {
  blocks: Array<Record<string, unknown>>;
  text: string;
}

export function buildSlackPayload(params: {
  ruleName: string;
  severity: string;
  category: string;
  source: string | null;
  matchedCount: number;
  windowMinutes: number;
  environment: string;
  firedAt: string;
  consoleUrl: string;
}): SlackPayload {
  const sevEmoji: Record<string, string> = {
    info: ':information_source:', warning: ':warning:',
    error: ':x:', critical: ':rotating_light:',
  };

  const text = `[${params.severity.toUpperCase()}] ${params.category}${params.source ? '/' + params.source : ''}: ${params.ruleName}`;

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${sevEmoji[params.severity] ?? ''} *[${params.severity.toUpperCase()}]* ${params.category}${params.source ? '/' + params.source : ''}\n*Rule:* ${params.ruleName}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Matched:* ${params.matchedCount} event${params.matchedCount === 1 ? '' : 's'} in ${params.windowMinutes}m` },
          { type: 'mrkdwn', text: `*Env:* ${params.environment}` },
          { type: 'mrkdwn', text: `*Fired:* ${params.firedAt}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'View in Console' }, url: params.consoleUrl },
        ],
      },
    ],
  };
}
