export interface EmailPayload {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function buildEmailPayload(params: {
  to: string;
  ruleName: string;
  severity: string;
  category: string;
  source: string | null;
  matchedCount: number;
  windowMinutes: number;
  environment: string;
  firedAt: string;
  consoleUrl: string;
}): EmailPayload {
  const subject = `[ALFA-OPS] ${params.severity.toUpperCase()} ${params.category} — ${params.ruleName}`;
  const textBody = [
    `Alert: ${params.ruleName}`,
    `Severity: ${params.severity}`,
    `Category: ${params.category}${params.source ? '/' + params.source : ''}`,
    `Matched: ${params.matchedCount} event(s) in ${params.windowMinutes}m`,
    `Environment: ${params.environment}`,
    `Fired at: ${params.firedAt}`,
    `Console: ${params.consoleUrl}`,
  ].join('\n');
  const htmlBody = `
    <h3 style="margin:0;">${params.ruleName}</h3>
    <p><strong>Severity:</strong> ${params.severity}<br/>
    <strong>Category:</strong> ${params.category}${params.source ? '/' + params.source : ''}<br/>
    <strong>Matched:</strong> ${params.matchedCount} event(s) in ${params.windowMinutes}m<br/>
    <strong>Environment:</strong> ${params.environment}<br/>
    <strong>Fired:</strong> ${params.firedAt}</p>
    <p><a href="${params.consoleUrl}">View in Console</a></p>
  `.trim();

  return { to: params.to, subject, textBody, htmlBody };
}
