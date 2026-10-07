import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { verifiedCustomerUser } from '@/lib/customer-session';
import { validMutationOrigin } from '@/lib/automation/auth';
import { boundedLifecycleBody, syncCustomerLifecycle, projectCustomerProgress } from '@/lib/customer-lifecycle';
import { prisma } from '@/lib/prisma';
import { controlledEmail, persistPreviewReceipt, validatePreviewReceipt } from '@/lib/decision/activation-preview-setup';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Single read-only Gmail receipt, not an Inbox connector. Credentials are request-local and never saved. */
export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return Response.json({ code: 'ORIGIN_REJECTED' }, { status: 403 });
  const user = await verifiedCustomerUser();
  if (user?.tier !== 'MICRO_PILOT' || !user.email.endsWith('@gmail.com')) return Response.json({ code: 'CONTROLLED_GMAIL_ACCOUNT_REQUIRED' }, { status: 403 });
  let client: ImapFlow | null = null;
  let lock: { release(): void } | null = null;
  try {
    const body = JSON.parse(await boundedLifecycleBody(request));
    if (!body || Object.keys(body).some(k => !['prospectEmail', 'messageId', 'appPassword'].includes(k)) ||
      typeof body.messageId !== 'string' || !/^<[^<>\s]{1,180}>$/.test(body.messageId) ||
      typeof body.appPassword !== 'string' || body.appPassword.length > 64)
      return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    const password = body.appPassword.replace(/\s/g, '');
    if (!/^[a-zA-Z0-9]{16,64}$/.test(password)) return Response.json({ code: 'INVALID_APP_PASSWORD' }, { status: 400 });
    const prospectEmail = controlledEmail(body.prospectEmail);
    const lead = await prisma.generatedLead.findFirst({ where: { userId: user.id, email: prospectEmail, prospectId: { not: null } }, select: { id: true } });
    if (!lead) return Response.json({ code: 'IMPORT_CONTROLLED_PROSPECT_FIRST' }, { status: 409 });
    if (await prisma.decision.findFirst({ where: { userId: user.id }, select: { id: true } }))
      return Response.json({ code: 'ACTIVATION_PREVIEW_EXHAUSTED' }, { status: 403 });
    const sourceMessageId = 'imap:' + createHash('sha256').update(user.email + '\0' + body.messageId).digest('hex');
    const existing = await prisma.inboundSignal.findFirst({ where: { userId: user.id, sourceMessageId }, select: { id: true } });
    if (existing) return Response.json({ status: 'REUSED', signalId: existing.id });
    if (await prisma.inboundSignal.findFirst({ where: { userId: user.id, signalAnalysis: 'MICRO_PILOT_ACTIVATION_PREVIEW_RECEIPT' }, select: { id: true } }))
      return Response.json({ code: 'PREVIEW_REPLY_ALREADY_CAPTURED' }, { status: 403 });
    const lifecycle = await syncCustomerLifecycle(user.email);
    const since = new Date(lifecycle.onboarding?.started_at);
    if (!Number.isFinite(since.getTime())) throw new Error('PURCHASE_CONTEXT_REQUIRED');
    client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: user.email, pass: password }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000 });
    await client.connect();
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    const matches = await client.search({ header: { 'Message-ID': body.messageId }, from: prospectEmail }, { uid: true });
    if (!matches || matches.length !== 1) throw new Error('EXACT_REPLY_REQUIRED');
    const metadata = await client.fetchOne(matches[0], { size: true, internalDate: true }, { uid: true });
    if (!metadata || !metadata.size || metadata.size > 65536) throw new Error('BOUNDED_REPLY_REQUIRED');
    const message = await client.fetchOne(matches[0], { source: true }, { uid: true });
    if (!message || !message.source) throw new Error('PROVIDER_REPLY_REQUIRED');
    const parsed = await simpleParser(message.source);
    const reply = { messageId: parsed.messageId ?? '', inReplyTo: typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : '',
      from: parsed.from?.value[0]?.address?.trim().toLowerCase() ?? '',
      to: (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap(a => a.value.map(v => v.address ?? '')),
      text: parsed.text?.trim() ?? '', receivedAt: new Date(metadata.internalDate ?? '') };
    if (reply.messageId !== body.messageId || parsed.headers.has('auto-submitted') && parsed.headers.get('auto-submitted') !== 'no')
      throw new Error('HUMAN_REPLY_REQUIRED');
    validatePreviewReceipt(reply, user.email, prospectEmail, since);
    lock.release(); lock = null;
    const sentFolder = (await client.list()).find(folder => folder.specialUse === '\\Sent');
    if (!sentFolder) throw new Error('SENT_EVIDENCE_REQUIRED');
    lock = await client.getMailboxLock(sentFolder.path, { readOnly: true });
    const sentIds = await client.search({ header: { 'Message-ID': reply.inReplyTo }, from: user.email, to: prospectEmail }, { uid: true });
    if (!sentIds || sentIds.length !== 1) throw new Error('WORKFLOW_THREAD_REQUIRED');
    const sent = await client.fetchOne(sentIds[0], { envelope: true, internalDate: true }, { uid: true });
    if (!sent || sent.envelope?.messageId !== reply.inReplyTo || !sent.envelope.from?.some(a => a.address?.toLowerCase() === user.email) ||
      !sent.envelope.to?.some(a => a.address?.toLowerCase() === prospectEmail) || !sent.internalDate || new Date(sent.internalDate) < since)
      throw new Error('WORKFLOW_THREAD_REQUIRED');
    const signal = await persistPreviewReceipt(user.id, lead.id, user.email, reply);
    lock.release(); lock = null;
    await client.logout(); client = null;
    await projectCustomerProgress(user.id);
    return Response.json({ status: 'RECEIVED', signalId: signal.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ code: 'REAL_REPLY_CAPTURE_UNAVAILABLE' }, { status: 409 }); }
  finally { lock?.release(); if (client) client.close(); }
}
