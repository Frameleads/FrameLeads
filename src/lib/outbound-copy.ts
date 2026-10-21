/** Normalize common long-dash and whitespace artifacts in generated outbound copy. */
export function normalizeOutboundCopy(value: string): string {
  return value
    .replace(/\u00e2\u20ac[\u201c\u201d]/gu, '. ')
    .replace(/[\u2012-\u2015\u2212]/gu, '. ')
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s+([,.;!?])/gu, '$1')
    .replace(/(?:\.\s*){2,}/gu, '. ')
    .replace(/([.!?])\s*([a-z])/gu, (_match, punctuation: string, letter: string) => `${punctuation} ${letter.toUpperCase()}`)
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
