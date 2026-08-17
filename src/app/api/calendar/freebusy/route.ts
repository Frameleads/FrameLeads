export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { google } from "googleapis";
import {
  addDays,
  addMinutes,
  format,
  getDay,
  isWithinInterval,
  parseISO,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  startOfDay,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

// ── Types ─────────────────────────────────────────────────────────────────
interface OperatingHours {
  start: string; // "09:00"
  end: string;   // "17:00"
}

interface FreeBusyRequest {
  timezone: string;        // IANA tz, e.g. "America/New_York"
  operatingHours: OperatingHours;
}

interface BusyBlock {
  start: string;
  end: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Parse "HH:MM" into { hours, minutes } */
function parseHHMM(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return { hours, minutes };
}

/**
 * Build the start of an operating day in UTC from a local date + timezone.
 * e.g. "09:00 on 2026-08-20 in America/New_York" → UTC Date
 */
function buildDayBoundary(
  localDate: Date,
  timeStr: string,
  timezone: string
): Date {
  const { hours, minutes } = parseHHMM(timeStr);
  // Start from midnight in UTC, then shift to the local day
  const dayInTz = toZonedTime(startOfDay(localDate), timezone);
  const withTime = setMilliseconds(
    setSeconds(setMinutes(setHours(dayInTz, hours), minutes), 0),
    0
  );
  // Convert back to UTC
  return new Date(
    withTime.getTime() - withTime.getTimezoneOffset() * 60000
  );
}

/** Get next N business days starting from tomorrow (skips Sat/Sun). */
function getNextBusinessDays(count: number): Date[] {
  const days: Date[] = [];
  let cursor = addDays(new Date(), 1);
  while (days.length < count) {
    const dow = getDay(cursor); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) {
      days.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return days;
}

/**
 * Given a list of busy blocks and a candidate 20-minute slot [slotStart, slotEnd],
 * return true if the slot overlaps any busy block.
 */
function overlapsAnyBusy(
  slotStart: Date,
  slotEnd: Date,
  busyBlocks: BusyBlock[]
): boolean {
  for (const block of busyBlocks) {
    const busyStart = parseISO(block.start);
    const busyEnd = parseISO(block.end);
    // Overlap condition: slot starts before busy ends AND slot ends after busy starts
    if (slotStart < busyEnd && slotEnd > busyStart) {
      return true;
    }
  }
  return false;
}

/**
 * Core slicer: generate available 20-minute slots for a list of business days,
 * respecting operating hours and Google's busy blocks.
 */
function computeAvailableSlots(
  businessDays: Date[],
  operatingHours: OperatingHours,
  timezone: string,
  busyBlocks: BusyBlock[]
): string[] {
  const slots: string[] = [];
  const SLOT_DURATION_MINUTES = 20;

  for (const day of businessDays) {
    const dayStart = buildDayBoundary(day, operatingHours.start, timezone);
    const dayEnd = buildDayBoundary(day, operatingHours.end, timezone);

    let cursor = dayStart;
    while (addMinutes(cursor, SLOT_DURATION_MINUTES) <= dayEnd) {
      const slotEnd = addMinutes(cursor, SLOT_DURATION_MINUTES);

      if (!overlapsAnyBusy(cursor, slotEnd, busyBlocks)) {
        // Format as human-readable string in the user's timezone
        // e.g. "Thursday, Aug 20 at 2:00 PM EST"
        const label = formatInTimeZone(
          cursor,
          timezone,
          "EEEE, MMM d 'at' h:mm a zzz"
        );
        slots.push(label);
      }

      cursor = slotEnd;
    }
  }

  return slots;
}

// ── Main Route Handler ────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body: FreeBusyRequest = await req.json();
    const { timezone, operatingHours } = body;

    if (!timezone || !operatingHours?.start || !operatingHours?.end) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: timezone, operatingHours.start, operatingHours.end" },
        { status: 400 }
      );
    }

    // ── Validate env vars ──────────────────────────────────────────────
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Missing Google OAuth environment variables." },
        { status: 401 }
      );
    }

    // ── Build OAuth2 client ────────────────────────────────────────────
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // ── Calculate the 5-day window ─────────────────────────────────────
    const businessDays = getNextBusinessDays(5);
    const windowStart = buildDayBoundary(businessDays[0], operatingHours.start, timezone);
    const windowEnd = buildDayBoundary(
      businessDays[businessDays.length - 1],
      operatingHours.end,
      timezone
    );

    // ── Query Google Calendar FreeBusy ─────────────────────────────────
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: timezone,
        items: [{ id: "primary" }],
      },
    });

    const busyBlocks: BusyBlock[] = (
      freeBusyResponse.data.calendars?.["primary"]?.busy ?? []
    )
      .filter((b): b is BusyBlock => typeof b.start === "string" && typeof b.end === "string");

    // ── Compute available slots ────────────────────────────────────────
    const available_slots = computeAvailableSlots(
      businessDays,
      operatingHours,
      timezone,
      busyBlocks as BusyBlock[]
    );

    return NextResponse.json({ success: true, available_slots }, { status: 200 });
  } catch (error: any) {
    console.error("[FREEBUSY] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
