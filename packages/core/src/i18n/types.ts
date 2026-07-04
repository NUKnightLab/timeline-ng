export interface TLLocale {
  id: string;
  name: string;
  /** Flat map of message keys to translated strings. */
  messages: Record<string, string>;
}

/**
 * Resolve a message key, substituting {placeholders} with values.
 * Falls back to the key itself if not found.
 */
export function getMessage(
  locale: TLLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let msg = locale.messages[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }
  }
  return msg;
}
