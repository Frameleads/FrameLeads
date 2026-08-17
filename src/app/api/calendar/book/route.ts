export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from '@/lib/prisma';

// ── Types ─────────────────────────────────────────────────────────────────
interface BookingRequest {
  leadId: string;
  prospectEmail: string;
  prospectName: string;
  startTimeIso: string; // e.g. "2026-08-20T14:00:00-04:00"
  endTimeIso: string;   // e.g. "2026-08-20T14:20:00-04:00"
}

// ── Main Route Handler ────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body: BookingRequest = await req.json();
    const { leadId, prospectEmail, prospectName, startTimeIso, endTimeIso } = body;

    // ── Validate payload ────────────────────────────────────────────────
    if (!leadId || !prospectEmail || !prospectName || !startTimeIso || !endTimeIso) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: leadId, prospectEmail, prospectName, startTimeIso, endTimeIso.",
        },
        { status: 400 }
      );
    }

    // ── Validate env vars ───────────────────────────────────────────────
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } =
      process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Missing Google OAuth environment variables." },
        { status: 401 }
      );
    }

    // ── Build OAuth2 client ─────────────────────────────────────────────
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // ── Construct the event payload ─────────────────────────────────────
    const eventPayload = {
      summary: `Architecture Teardown: ${prospectName} & FrameLeads`,
      description: [
        "This is an automated booking via the FrameLeads Zero-Click Concierge.",
        "",
        "Agenda:",
        "  • Live walkthrough of the Autonomous Acquisition Architecture",
        "  • Pipeline fragility diagnostic specific to your operation",
        "  • Velvet Rope Protocol demo — governed AI, human override",
        "",
        "Join via the Google Meet link below. No preparation required.",
      ].join("\n"),
      start: {
        dateTime: startTimeIso,
      },
      end: {
        dateTime: endTimeIso,
      },
      attendees: [
        {
          email: prospectEmail,
          displayName: prospectName,
        },
      ],
      // Auto-generate a Google Meet link
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    // ── Insert the event ────────────────────────────────────────────────
    // conferenceDataVersion: 1 is required to trigger Meet link generation.
    // sendUpdates: 'all' dispatches a calendar invite email to the attendee.
    const event = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: eventPayload,
    });

    const meetLink = event.data.hangoutLink ?? null;
    const eventLink = event.data.htmlLink ?? null;

    if (!meetLink) {
      // Event was created but Meet link generation failed — still return the event link
      console.warn(
        "[BOOK] Google Meet link was not returned. Event may still have been created:",
        event.data.id
      );
    }

    // Task 2: Mutate Prisma Lifecycle Status
    await prisma.inboundSignal.update({
      where: { id: leadId },
      data: { 
        status: 'APPROVED',
        approvedAt: new Date()
      }
    });

    return NextResponse.json(
      {
        success: true,
        event_id: event.data.id,
        meet_link: meetLink,
        event_link: eventLink,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[BOOK] Error inserting calendar event:", error);

    // Surface the Google API error message if available
    const googleMessage =
      error?.response?.data?.error?.message || error?.message;

    return NextResponse.json(
      {
        success: false,
        error: googleMessage || "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}
