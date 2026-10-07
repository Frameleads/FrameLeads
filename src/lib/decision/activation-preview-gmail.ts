import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { validatePreviewReceipt } from './activation-preview-setup';

/** Server-only, read-only provider verification. Password is request-local; no logger, send or storage. */
export async function readPreviewGmailReply(input:{mailbox:string;prospectEmail:string;messageId:string;appPassword:string;since:Date}){
 let client:ImapFlow|null=null,lock:{release():void}|null=null;
 const prospectEmail=input.prospectEmail,since=input.since;
 const password=input.appPassword.replace(/\s/g,'');
 if(!/^<[^<>\s]{1,180}>$/.test(input.messageId)|| !/^[a-zA-Z0-9]{16,64}$/.test(password))throw new Error('INVALID_PROVIDER_CREDENTIAL_INPUT');
 try{
    client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: input.mailbox, pass: password }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000 });
    await client.connect();
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    const matches = await client.search({ header: { 'Message-ID': input.messageId }, from: prospectEmail }, { uid: true });
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
    if (reply.messageId !== input.messageId || parsed.headers.has('auto-submitted') && parsed.headers.get('auto-submitted') !== 'no')
      throw new Error('HUMAN_REPLY_REQUIRED');
    validatePreviewReceipt(reply, input.mailbox, prospectEmail, since);
    lock.release(); lock = null;
    const sentFolder = (await client.list()).find(folder => folder.specialUse === '\\Sent');
    if (!sentFolder) throw new Error('SENT_EVIDENCE_REQUIRED');
    lock = await client.getMailboxLock(sentFolder.path, { readOnly: true });
    const sentIds = await client.search({ header: { 'Message-ID': reply.inReplyTo }, from: input.mailbox, to: prospectEmail }, { uid: true });
    if (!sentIds || sentIds.length !== 1) throw new Error('WORKFLOW_THREAD_REQUIRED');
    const sent = await client.fetchOne(sentIds[0], { envelope: true, internalDate: true }, { uid: true });
    if (!sent || sent.envelope?.messageId !== reply.inReplyTo || !sent.envelope.from?.some(a => a.address?.toLowerCase() === input.mailbox) ||
      !sent.envelope.to?.some(a => a.address?.toLowerCase() === prospectEmail) || !sent.internalDate || new Date(sent.internalDate) < since)
      throw new Error('WORKFLOW_THREAD_REQUIRED');

    lock.release();lock=null;await client.logout();client=null;return reply;
 }finally{lock?.release();client?.close();input.appPassword='';}
}
