/**
 * Format plain-text inbound emails for on-screen reading only.
 *
 * Email providers and copied drafts often insert a hard newline mid-sentence
 * (e.g. "We're an\n11-person team"). Join those soft line breaks so the
 * browser wraps text naturally at the actual card width. Blank-line paragraph
 * boundaries remain intact. Never use this helper when saving, analyzing,
 * approving, sending, or copying the original message.
 */
export function formatInboundReplyForDisplay(reply: string): string {
  return reply
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' '))
    .join('\n\n');
}
