/** Normalize Livy statement output text (string or string[]). */
export function normalizeLivyText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((part) => String(part)).join('');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function extractLivyPlainText(data: Record<string, unknown>): string {
  const textPlain = data['text/plain'];
  if (textPlain !== undefined) {
    return normalizeLivyText(textPlain);
  }
  const appJson = data['application/json'];
  if (appJson !== undefined) {
    return normalizeLivyText(appJson);
  }
  return '';
}
