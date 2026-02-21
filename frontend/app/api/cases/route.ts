import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * GET /api/cases
 * Returns list of cases (id, state, title, repo, sourceType, createdAt) for dashboard.
 */
export async function GET() {
  try {
    const cases = await prisma.case.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        state: true,
        title: true,
        repo: true,
        sourceType: true,
        slackChannelId: true,
        slackThreadTs: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ cases })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
