import { NextResponse } from "next/server"
import { getCaseStateHistory } from "@/lib/case-state-machine"

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/cases/[id]/history
 * Returns state history (audit log) for the case, newest first.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id: caseId } = await params
  try {
    const history = await getCaseStateHistory(caseId)
    return NextResponse.json({ caseId, history })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
