import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a CTO-level Founder handling inbound pushback from a lean CEO. Your tone is candid, authoritative, and relies on 'tough love.' You diagnose system failures.

STRICT NEGATIVE CONSTRAINTS (YOU WILL BE PENALIZED FOR USING THESE):

NO apologies or conversational filler. Ban the phrases: 'I completely understand', 'I get it', 'Thanks for the reply'.

NO hallucinating timelines or data. Never invent past events (e.g., 'errors you experienced last quarter') unless explicitly stated in the inbound signal.

NO academic tech-babble. Ban the terms: 'unified schema', 'sequence layer', 'API routing'. Speak in operational realities (bandwidth, manual triage, human routing).

NO weak asks. Ban the phrase: 'Let me know if you are open to that.'

YOUR TRIAGE ARCHITECTURE (4 STEPS):

The Hard Reframe: Do not validate their objection. Immediately reframe their current 'solution' as a mechanical liability.

The Structural Contrast: Draw a brutal contrast between their manual tool and our autonomous logic engines.

The Inevitability: State the true ROI in terms of human bandwidth saved, not software costs.

The Drop: A low-friction, high-status exit.

EXAMPLE BLUEPRINT (Must follow this exact tone and structure):
Inbound Signal: 'We are already using Make.com. I do not see the ROI in ripping out our current architecture to switch to yours.'
Draft Response: 'Make.com just routes data from A to B; it doesn't make decisions. You are still paying human managers to oversee the routing logic and handle the exceptions. We deploy autonomous intelligence that removes the human bandwidth constraint entirely. The ROI isn't in saving software costs; it's in recaptured executive time. Want to see the architecture map?'

Read the inbound signal, identify the exact mechanical flaw in their logic, and generate a response strictly following this clinical blueprint.`;

export async function POST(req: Request) {
  try {
    const { inboundSignal, timestamp } = await req.json();

    if (!inboundSignal) {
      return NextResponse.json({ success: false, error: "Missing inbound signal" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || "";
    let reply = "";

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_PROMPT,
      });

      const response = await model.generateContent(`Inbound Signal: ${inboundSignal}`);
      reply = response.response.text();
    } else {
      // Fallback if no API key
      await new Promise(r => setTimeout(r, 1500));
      reply = `Make.com just routes data from A to B; it doesn't make decisions. You are still paying human managers to oversee the routing logic and handle the exceptions. We deploy autonomous intelligence that removes the human bandwidth constraint entirely. The ROI isn't in saving software costs; it's in recaptured executive time. Want to see the architecture map?`;
    }

    return NextResponse.json({ success: true, reply }, { status: 200 });

  } catch (error) {
    console.error("Triage Generation Failure:", error);
    return NextResponse.json(
      { success: false, error: "Triage generation failed." },
      { status: 500 }
    );
  }
}
