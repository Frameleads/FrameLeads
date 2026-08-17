export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are an elite B2B copywriter. Analyze the provided website HTML. Extract the core business offering. Return a strict JSON object with two keys: targetAudience (who they sell to, max 5 words) and valueProposition (what painful problem they solve, stripped of ALL corporate jargon, written in punchy 6th-grade English, max 15 words).`;

function extractJsonObject(rawText: string): any {
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Failed to locate JSON object in response: ${rawText}`);
  }

  const jsonString = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid URL" },
        { status: 400 }
      );
    }

    // ── Fetch HTML from the provided URL ──────────────────────────────
    let rawHtml: string;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; FrameLeads-MagicAssist/1.0; +https://frameleads.io)",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return NextResponse.json(
          { success: false, error: `Failed to fetch URL: ${response.statusText}` },
          { status: 502 }
        );
      }

      rawHtml = await response.text();
    } catch (fetchErr: any) {
      return NextResponse.json(
        { success: false, error: `Could not reach the URL: ${fetchErr?.message || String(fetchErr)}` },
        { status: 502 }
      );
    }

    // ── Strip noisy tags to reduce payload size ────────────────────────
    const cleaned = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<[^>]+>/g, " ")         // strip remaining HTML tags
      .replace(/\s{2,}/g, " ")          // collapse whitespace
      .trim()
      .slice(0, 8000);                  // truncate to keep prompt tight

    // ── Call Claude ────────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Missing Anthropic API Key" },
        { status: 401 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Website content:\n${cleaned}` }],
    });

    const responseText = (response.content[0] as any).text;
    const parsed = extractJsonObject(responseText);

    return NextResponse.json({
      success: true,
      targetAudience: parsed.targetAudience || "",
      valueProposition: parsed.valueProposition || "",
    });
  } catch (error: any) {
    console.error("[MAGIC ASSIST] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
