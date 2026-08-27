import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PIPELINE_VALUE } from "@/lib/pipeline-value";
import { decrypt } from "@/lib/encryption";
import { resolvePublicImapHost } from "@/lib/imap-security";
import { POST as classifyTriageSignal } from "@/app/api/triage/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSourceMessageId(mailboxEmail: string, messageId: string | undefined, uid: number) {
  const mailboxMessageKey = `${normalizeEmail(mailboxEmail)}\0${messageId || `uid:${uid}`}`;
  return `imap:${createHash("sha256").update(mailboxMessageKey).digest("hex")}`;
}

export async function POST() {
  let imapClient: ImapFlow | null = null;
  let releaseMailboxLock: (() => void) | null = null;

  try {
    const cookieStore = await cookies();
    const sessionEmail = cookieStore.get("user_email")?.value;
    const user = sessionEmail
      ? await prisma.user.findUnique({
          where: { email: normalizeEmail(sessionEmail) },
          select: {
            id: true,
            imapEmail: true,
            imapPassword: true,
            imapHost: true,
            imapPort: true,
          },
        })
      : null;

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    if (!user.imapEmail || !user.imapPassword || !user.imapHost || !user.imapPort) {
      return NextResponse.json(
        { success: false, error: "Connect an inbox before syncing." },
        { status: 409 },
      );
    }

    const leads = await prisma.generatedLead.findMany({
      where: { userId: user.id, email: { not: null } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
      },
    });
    const knownLeads = leads.filter(
      (lead): lead is typeof lead & { email: string } => Boolean(lead.email?.trim()),
    );

    if (knownLeads.length === 0) {
      return NextResponse.json({ success: true, newSignalsAdded: 0 });
    }

    const appPassword = decrypt(user.imapPassword);
    const resolvedHost = await resolvePublicImapHost(user.imapHost);
    imapClient = new ImapFlow({
      host: resolvedHost.address,
      port: user.imapPort,
      secure: user.imapPort === 993,
      tls: { servername: resolvedHost.hostname },
      auth: { user: user.imapEmail, pass: appPassword },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 45_000,
    });
    imapClient.on("error", () => undefined);

    await imapClient.connect();
    const mailboxLock = await imapClient.getMailboxLock("INBOX");
    releaseMailboxLock = mailboxLock.release;

    const searchResult = await imapClient.search({ seen: false }, { uid: true });
    const unseenUids = Array.isArray(searchResult) ? searchResult : [];

    if (unseenUids.length === 0) {
      return NextResponse.json({ success: true, newSignalsAdded: 0 });
    }

    const matchedByUid = new Map<
      number,
      { lead: (typeof knownLeads)[number]; sourceMessageId: string }
    >();

    // Fetch envelope metadata first. Unknown senders are hard-dropped before
    // their message source or body is downloaded and parsed.
    for await (const message of imapClient.fetch(
      unseenUids,
      { uid: true, envelope: true },
      { uid: true },
    )) {
      const senderEmail = normalizeEmail(message.envelope?.from?.[0]?.address || "");
      const matchedLead = knownLeads.find(
        (lead) => normalizeEmail(lead.email) === senderEmail,
      );
      if (!matchedLead) continue;

      matchedByUid.set(message.uid, {
        lead: matchedLead,
        sourceMessageId: buildSourceMessageId(
          user.imapEmail,
          message.envelope?.messageId,
          message.uid,
        ),
      });
    }

    if (matchedByUid.size === 0) {
      return NextResponse.json({ success: true, newSignalsAdded: 0 });
    }

    const existingSignals = await prisma.inboundSignal.findMany({
      where: {
        userId: user.id,
        sourceMessageId: {
          in: Array.from(matchedByUid.values(), (message) => message.sourceMessageId),
        },
      },
      select: { sourceMessageId: true },
    });
    const existingMessageIds = new Set(
      existingSignals.map((signal) => signal.sourceMessageId).filter(Boolean),
    );
    const newMatchedUids = Array.from(matchedByUid.entries())
      .filter(([, message]) => !existingMessageIds.has(message.sourceMessageId))
      .map(([uid]) => uid);

    if (newMatchedUids.length === 0) {
      return NextResponse.json({ success: true, newSignalsAdded: 0 });
    }

    const signalsToCreate: Prisma.InboundSignalCreateManyInput[] = [];
    for await (const message of imapClient.fetch(
      newMatchedUids,
      { uid: true, source: true },
      { uid: true },
    )) {
      if (!message.source) continue;

      const parsedMessage = await simpleParser(message.source);
      const senderEmail = normalizeEmail(parsedMessage.from?.value?.[0]?.address || "");
      const matched = matchedByUid.get(message.uid);

      // Re-check the parsed From address before persistence. A mismatch is
      // discarded immediately and is never logged or saved.
      if (!matched || normalizeEmail(matched.lead.email) !== senderEmail) continue;

      const htmlBody = typeof parsedMessage.html === "string" ? stripHtml(parsedMessage.html) : "";
      const rawBody = parsedMessage.text?.trim() || htmlBody || "(No text body)";
      const cleanBody = rawBody.split(/(On\s.+?wrote:|From:\s.+?Sent:\s.+?To:)/i)[0].trim();
      const subject = parsedMessage.subject?.trim() || "";
      const prospectName = [matched.lead.firstName, matched.lead.lastName]
        .filter(Boolean)
        .join(" ");

      signalsToCreate.push({
        userId: user.id,
        generatedLeadId: matched.lead.id,
        sourceMessageId: matched.sourceMessageId,
        prospectName: prospectName || matched.lead.email,
        prospectContext: subject
          ? `${matched.lead.companyName} | Subject: ${subject.slice(0, 500)}`
          : matched.lead.companyName,
        prospectEmail: matched.lead.email,
        pipelineValue: DEFAULT_PIPELINE_VALUE,
        dealStage: "Reply Received",
        rawEmail: cleanBody || "(No text body)",
        intentRisk: "Unclassified",
        intentType: "UNCLASSIFIED",
        intentScore: 0,
        confidenceScore: 0,
        signalAnalysis: null,
        aiDraft: "",
        status: "PENDING",
        isHighPriority: false,
        sourceType: "IMAP_NATIVE",
        signalType: "EMAIL_REPLY",
      });
    }

    if (signalsToCreate.length === 0) {
      return NextResponse.json({ success: true, newSignalsAdded: 0 });
    }

    const insertedSignals = await prisma.inboundSignal.createManyAndReturn({
      data: signalsToCreate,
      skipDuplicates: true,
      select: { id: true },
    });

    releaseMailboxLock?.();
    releaseMailboxLock = null;
    if (imapClient) {
      if (imapClient.usable) await imapClient.logout().catch(() => imapClient?.close());
      else imapClient.close();
      imapClient = null;
    }

    await Promise.allSettled(
      insertedSignals.map(async ({ id }) => {
        const classificationResponse = await classifyTriageSignal(
          new Request("http://frameleads.internal/api/triage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signalId: id }),
          }),
        );

        if (!classificationResponse.ok) {
          console.error(
            `[NATIVE IMAP CLASSIFICATION ERROR]: Signal ${id} returned ${classificationResponse.status}`,
          );
        }
      }),
    );

    return NextResponse.json({ success: true, newSignalsAdded: insertedSignals.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown IMAP error";
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes("rate") || normalizedMessage.includes("too many")) {
      return NextResponse.json(
        { success: false, error: "Mailbox rate limit reached. Please retry shortly." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    if (message.includes("ENCRYPTION_KEY") || message.includes("Stored IMAP password")) {
      return NextResponse.json(
        { success: false, error: "Mailbox encryption is not configured correctly." },
        { status: 503 },
      );
    }

    console.error("[NATIVE IMAP SYNC ERROR]:", message);
    return NextResponse.json(
      { success: false, error: "Unable to sync the connected inbox." },
      { status: 502 },
    );
  } finally {
    releaseMailboxLock?.();
    if (imapClient) {
      if (imapClient.usable) await imapClient.logout().catch(() => imapClient?.close());
      else imapClient.close();
    }
  }
}
