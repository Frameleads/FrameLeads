import { NextResponse } from 'next/server';

/**
 * Legacy endpoint used to mark an inbox signal APPROVED without transmitting
 * email. Keep fail-closed to avoid false "Sent" confirmations and bypassing
 * the canonical Decision execution/suppression audit.
 */
export async function POST() {
  return NextResponse.json({
    success: false, error: 'Legacy dispatch has been retired. Use the authenticated Inbox Triage manual-send workflow.',
  }, { status: 410 });
}
