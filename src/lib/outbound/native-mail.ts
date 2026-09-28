import nodemailer from 'nodemailer';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from '../encryption';
import { resolvePublicImapHost } from '../imap-security';

export class NativeMailUnavailable extends Error {}
export function resolveSmtpSettings(imapHost: string) {
  const host = imapHost.trim().toLowerCase();
  if (host.includes('gmail')) return { host: 'smtp.gmail.com', port: 465, secure: true };
  if (host.includes('outlook') || host.includes('office365') || host.includes('hotmail'))
    return { host: 'smtp.office365.com', port: 587, secure: false };
  if (host.includes('yahoo')) return { host: 'smtp.mail.yahoo.com', port: 465, secure: true };
  if (host.startsWith('imap.')) return { host: `smtp.${host.slice(5)}`, port: 465, secure: true };
  return null;
}
export function htmlToPlainText(html: string) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim();
}

/** Canonical native-mail sender for authenticated manual sends and governed Decision execution. */
export async function sendNativeEmail(input: { userId: string; leadId: string; to: string; subject: string;
  text: string; html?: string }, db: PrismaClient = prisma) {
  const to = input.to.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(to) || !input.subject.trim() || input.subject.length > 500 ||
    !input.text.trim() || input.text.length > 200_000) throw new TypeError('Invalid native email');
  const [user, lead] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { imapEmail: true, imapPassword: true, imapHost: true } }),
    db.generatedLead.findFirst({ where: { id: input.leadId, userId: input.userId }, select: { email: true } }),
  ]);
  if (!lead?.email || lead.email.trim().toLowerCase() !== to) throw new NativeMailUnavailable('Recipient is not an owned lead');
  if (!user?.imapEmail || !user.imapPassword || !user.imapHost) throw new NativeMailUnavailable('Native inbox is not connected');
  const settings = resolveSmtpSettings(user.imapHost);
  if (!settings) throw new NativeMailUnavailable('Mailbox host has no supported SMTP mapping');
  const publicHost = await resolvePublicImapHost(settings.host);
  const transport = nodemailer.createTransport({ host: publicHost.address, port: settings.port,
    secure: settings.secure, auth: { user: user.imapEmail, pass: decrypt(user.imapPassword) },
    tls: { servername: publicHost.hostname }, connectionTimeout: 15_000, greetingTimeout: 10_000,
    socketTimeout: 30_000 });
  try {
    const sent = await transport.sendMail({ from: user.imapEmail, to: lead.email, subject: input.subject.trim(),
      text: input.text.trim(), ...(input.html ? { html: input.html } : {}) });
    return { provider: 'NATIVE_SMTP', providerMessageId: sent.messageId || null };
  } finally { transport.close(); }
}
