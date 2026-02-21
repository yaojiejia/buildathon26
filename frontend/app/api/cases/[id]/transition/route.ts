import { NextResponse } from "next/server"
import { transitionCase } from "@/lib/case-state-machine"

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/cases/[id]/transition
 * Body: { toState: string, metadata?: object }
 * Validates transition, rejects illegal ones, records audit log.
 */
export async function POST(
  request: Request,
  { params }: Params
) {
  const { id: caseId } = await params
  try {
    const body = (await request.json()) as { toState?: string; metadata?: Record<string, unknown> }
    const toState = body?.toState
    if (!toState || typeof toState !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid toState" },
        { status: 400 }
      )
    }
    const result = await transitionCase(caseId, toState.trim(), body.metadata)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
