import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * GET /api/cases/:id
 * Fetch a single case by ID, including recent state transitions.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const caseRecord = await prisma.case.findUnique({
      where: { id: params.id },
    })

    if (!caseRecord) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }

    return NextResponse.json({ case: caseRecord })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
