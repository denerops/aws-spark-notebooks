export function sanitizeErrorMessage(raw: string): string {
  const lines = raw.split('\n');
  const messageLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\s*at\s+/.test(line) || trimmed.startsWith('at ')) {
      break;
    }
    if (trimmed) {
      messageLines.push(trimmed);
    }
  }

  let message = messageLines.join(' ').trim() || raw.trim();
  message = message.replace(/^Error:\s*/i, '');
  return message;
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return sanitizeErrorMessage(String(error));
}
