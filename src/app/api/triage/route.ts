import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import {
  addDays,
  addMinutes,
  getDay,
  parseISO,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  startOfDay,
} from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

const SYSTEM_PROMPT = `You are an elite, high-status B2B technical founder running an Inbox Triage system. Your job is to read the prospect's reply, classify their intent, and execute a surgical response based on strict psychological frameworks.

PERSONA LOCK & CONSTRAINTS:
Never open with "Thanks for the reply," "Hope this helps," or any variant of gratitude/eagerness. You are running a diagnostic.
6th-grade vocabulary strictly enforced. Banned words: synergy, optimize, touch base, value-add, robust, seamless.
Every response agrees with the objection's surface claim before questioning it—never argue with the stated reason first.
Maximum 3 sentences. No exceptions.
Never cite statistics, percentages, or numbers to justify your stance.

EXECUTION MATRIX (Analyze the email and apply the matching framework):

SCENARIO 1: THE SMOKESCREEN ("send me info" / "what's the price")
Framework: Agree, then isolate whether price is the real blocker or a polite exit. (Applies the Accusation Audit + Calibrated Question).
Output: "Sure, I can send a number. Before I do — is price the actual thing stopping you, or is something else on your mind?".

SCENARIO 2: PRICE OBJECTION ("too expensive")
Framework: Agree with the concern, isolate value from price, redirect to cost of inaction. (Leverages Loss Aversion).
Output: "Fair — budget's always tight. If price wasn't a factor, is this the fix you'd actually want? Because the real question is what the current gap is already costing you.".

SCENARIO 3: TIMING OBJECTION ("not right now")
Framework: Agree, then surface whether "not now" means "never" or just unprioritized.
Output: "Makes sense — timing's everything. Is this a 'not a priority' or a 'not this month' kind of not now?".

SCENARIO 4: SKEPTICISM ("sounds too good" / "how do I know this works")
Framework: Agree with the skepticism directly — don't defend, validate it as the correct instinct.
Output: "You should be skeptical — most tools in this space overpromise. That's the exact reason nothing sends here without you reviewing it first.".

SCENARIO 5: COMPETITOR MENTION ("we already use [tool]")
Framework: Agree, then isolate the specific gap rather than attacking the competitor.
Output: "Good, that means you already know what this space is missing. What's the one thing that tool still doesn't catch?".

SCENARIO 6: AUTHORITY DEFLECTION ("need to check with my partner/team")
Framework: Agree, then ask what would make the internal conversation easier, not push for a bypass.
Output: "Smart to loop them in. What would they actually need to see to make this an easy yes?".

SCENARIO 10: HOT LEAD ("yes" / "interested")
Framework: Zero-Click Concierge. Surface two exact, pre-calculated available slots and instruct the prospect to simply pick one. Never use a calendar link or generic CTA.
Output: "I have a 20-minute window to tear this down on {{SLOT_1}}, or {{SLOT_2}}. Let me know which clears your desk, and my system will lock it in.".

FALLBACK RULE:
If the prospect's reply does not cleanly match one of these specific scenarios, return a valid JSON object explaining the failure in strategy_logic and setting draft_response to [FLAG_FOR_EXECUTIVE_OVERRIDE].

OUTPUT FORMAT:
Generate your output STRICTLY as a JSON object matching this schema. Do not include any other text or markdown outside the JSON.
{
  "intent_score": 85, // Number between 0-100. Hot leads = 80-100, Warm = 40-79, Cold/Objections = 10-39, Ghost/Disqualified = 0-9
  "temperature": "🔥 HOT", // String ("🔥 HOT", "☀️ WARM", "❄️ COLD", or "🛑 BLOCKED")
  "signal_tags": ["Price sensitivity", "Loss aversion detected"], // Array of Strings (Max 3 punchy tags)
  "strategy_logic": "Applied Ackerman Bargaining to isolate price from value.", // 1-sentence explanation of the framework
  "draft_response": "The actual 3-sentence email draft here." // The final email draft
}`;

// ── Calendar Slot Helpers (inlined from freebusy route) ─────────────────

interface BusyBlock { start: string; end: string; }

function parseHHMM(t: string) {
  const [hours, minutes] = t.split(':').map(Number);
  return { hours, minutes };
}

function buildDayBoundary(localDate: Date, timeStr: string, timezone: string): Date {
  const { hours, minutes } = parseHHMM(timeStr);
  const dayInTz = toZonedTime(startOfDay(localDate), timezone);
  const withTime = setMilliseconds(setSeconds(setMinutes(setHours(dayInTz, hours), minutes), 0), 0);
  return new Date(withTime.getTime() - withTime.getTimezoneOffset() * 60000);
}

function getNextBusinessDays(count: number): Date[] {
  const days: Date[] = [];
  let cursor = addDays(new Date(), 1);
  while (days.length < count) {
    const dow = getDay(cursor);
    if (dow !== 0 && dow !== 6) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function overlapsAnyBusy(slotStart: Date, slotEnd: Date, busyBlocks: BusyBlock[]): boolean {
  for (const block of busyBlocks) {
    if (slotStart < parseISO(block.end) && slotEnd > parseISO(block.start)) return true;
  }
  return false;
}

async function fetchAvailableSlots(timezone = 'America/New_York'): Promise<string[]> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  // Gracefully return empty if creds are missing — triage still works without slots
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return [];

  try {
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const businessDays = getNextBusinessDays(5);
    const operatingHours = { start: '09:00', end: '17:00' };
    const windowStart = buildDayBoundary(businessDays[0], operatingHours.start, timezone);
    const windowEnd = buildDayBoundary(businessDays[businessDays.length - 1], operatingHours.end, timezone);

    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: timezone,
        items: [{ id: 'primary' }],
      },
    });

    const busyBlocks: BusyBlock[] = (
      freeBusyResponse.data.calendars?.['primary']?.busy ?? []
    ).filter((b): b is BusyBlock => typeof b.start === 'string' && typeof b.end === 'string');

    const slots: string[] = [];
    for (const day of businessDays) {
      const dayStart = buildDayBoundary(day, operatingHours.start, timezone);
      const dayEnd = buildDayBoundary(day, operatingHours.end, timezone);
      let cursor = dayStart;
      while (addMinutes(cursor, 20) <= dayEnd) {
        const slotEnd = addMinutes(cursor, 20);
        if (!overlapsAnyBusy(cursor, slotEnd, busyBlocks)) {
          slots.push(formatInTimeZone(cursor, timezone, "EEEE, MMM d 'at' h:mm a zzz"));
        }
        cursor = slotEnd;
      }
      if (slots.length >= 2) break; // We only need the first two
    }
    return slots;
  } catch (err) {
    console.warn('[TRIAGE] Could not fetch calendar slots, proceeding without:', err);
    return [];
  }
}

// Builds the runtime system prompt with temporal context injected
function buildSystemPrompt(slot1: string, slot2: string): string {
  const conciergeOutput = slot1 && slot2
    ? `"I have a 20-minute window to tear this down on ${slot1}, or ${slot2}. Let me know which clears your desk, and my system will lock it in."`
    : `"I have a couple of open windows this week for a 20-minute teardown. What does your schedule look like?"` ;

  return SYSTEM_PROMPT
    .replace('{{SLOT_1}}', slot1 || 'early this week')
    .replace('{{SLOT_2}}', slot2 || 'later this week')
    .replace(
      'Output: "I have a 20-minute window to tear this down on {{SLOT_1}}, or {{SLOT_2}}. Let me know which clears your desk, and my system will lock it in.".',
      `NEXT AVAILABLE SLOTS: ${slot1 || 'TBD'} or ${slot2 || 'TBD'}\nOutput: ${conciergeOutput}.`
    );
}

function extractJsonObject(rawText: string): any {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Failed to locate JSON object in response: ${rawText}`);
  }
  
  const jsonString = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

import { requireEnterpriseTier } from '@/lib/auth-guard';

export async function POST(req: Request) {
  try {
    const authError = await requireEnterpriseTier();
    if (authError) return authError;

    const { inboundSignal, timestamp } = await req.json();

    if (!inboundSignal) {
      return NextResponse.json({ success: false, error: "Missing inbound signal" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    let jsonResponse: any = null;

    // ── Fetch temporal context (non-blocking — triage works even if Google is unavailable)
    const timezone = process.env.CALENDAR_TIMEZONE || 'America/New_York';
    const availableSlots = await fetchAvailableSlots(timezone);
    const slot1 = availableSlots[0] || '';
    const slot2 = availableSlots[1] || '';
    const runtimePrompt = buildSystemPrompt(slot1, slot2);

    if (apiKey) {
      const anthropic = new Anthropic({ apiKey });
      
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        temperature: 0.7,
        system: runtimePrompt,
        messages: [{ role: 'user', content: `Inbound Signal: ${inboundSignal}` }]
      });

      const rawText = (response.content[0] as any).text.trim();
      jsonResponse = extractJsonObject(rawText);
    } else {
      // Fallback if no API key
      await new Promise(r => setTimeout(r, 1500));
      jsonResponse = {
        intent_score: 35,
        temperature: "❄️ COLD",
        signal_tags: ["Structural Objection", "Software vs Service", "Human Bandwidth"],
        strategy_logic: "Intent classified as structural objection (Security/Hallucination fear). Applied Structural Contrast framework.",
        draft_response: "Make.com just routes data from A to B; it doesn't make decisions. You are still paying human managers to oversee the routing logic and handle the exceptions. We deploy autonomous intelligence that removes the human bandwidth constraint entirely. The ROI isn't in saving software costs; it's in recaptured executive time. Want to see the architecture map?"
      };
    }

    return NextResponse.json({ success: true, ...jsonResponse }, { status: 200 });

  } catch (error) {
    console.error("Triage Generation Failure:", error);
    return NextResponse.json(
      { success: false, error: "Triage generation failed." },
      { status: 500 }
    );
  }
}
