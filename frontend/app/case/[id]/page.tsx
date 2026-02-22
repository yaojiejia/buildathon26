"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { EngineProvider, useEngine } from "@/lib/engine"
import { ThemeProvider } from "@/lib/theme"
import { Navbar } from "@/components/layout/navbar"
import { InvestigatePage } from "@/components/investigate/investigate-page"
import { GlowingEffect } from "@/components/ui/glowing-effect"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  Github,
  Clock,
  Zap,
  Play,
  Loader2,
} from "lucide-react"

interface CaseData {
  id: string
  githubIssueId: number
  repo: string
  title: string
  body: string | null
  state: string
  createdAt: string
}

function CaseHero({ caseData }: { caseData: CaseData }) {
  const { state, startInvestigation } = useEngine()

  const handleRealInvestigation = () => {
    startInvestigation({
      issueTitle: caseData.title,
      issueBody: caseData.body ?? "",
      repoUrl: `https://github.com/${caseData.repo}`,
      repoName: caseData.repo,
    })
  }

  const handleDemoInvestigation = () => {
    startInvestigation()
  }

  if (state.status !== "idle") {
    return <InvestigatePage />
  }

  const severity = caseData.state === "NEW" ? "new" : caseData.state.toLowerCase()

  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
      <div className="w-full max-w-2xl px-6">
        <div className="group relative rounded-2xl">
          <GlowingEffect
            spread={40}
            glow={true}
            disabled={false}
            proximity={64}
            inactiveZone={0.01}
            borderWidth={2}
          />
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] shadow-2xl">
            <div className="absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-cyan-500/8 blur-3xl" />

            <div className="relative p-8">
              {/* Status badge */}
              <div className="mb-4 flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {severity.toUpperCase()}
                </span>
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-muted-foreground">
                  #{caseData.githubIssueId}
                </span>
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold tracking-tight text-foreground/95">
                {caseData.title}
              </h1>

              {/* Meta row */}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Github className="h-3.5 w-3.5" />
                  {caseData.repo}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(caseData.createdAt).toLocaleString()}
                </span>
              </div>

              {/* Body */}
              {caseData.body && (
                <p className="mt-5 text-sm leading-relaxed text-foreground/60">
                  {caseData.body}
                </p>
              )}

              {/* Divider */}
              <div className="my-6 h-px bg-white/[0.06]" />

              {/* CTA */}
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleRealInvestigation}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold",
                    "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20",
                    "transition-all hover:bg-cyan-500/20 hover:border-cyan-500/30",
                    "active:scale-[0.98]"
                  )}
                >
                  <Zap className="h-4 w-4 text-cyan-400" />
                  Launch Investigation
                </button>
                <button
                  onClick={handleDemoInvestigation}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold",
                    "bg-white/[0.04] text-foreground/50 border border-white/[0.08]",
                    "transition-all hover:bg-white/[0.08] hover:border-white/[0.12]",
                    "active:scale-[0.98]"
                  )}
                >
                  <Play className="h-4 w-4" />
                  Demo Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CaseContent() {
  const params = useParams()
  const caseId = params.id as string
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchCase() {
      try {
        const res = await fetch(`/api/cases/${caseId}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? "Failed to load case")
          return
        }
        setCaseData(data.case)
      } catch {
        setError("Failed to connect to server")
      } finally {
        setLoading(false)
      }
    }
    fetchCase()
  }, [caseId])

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <p className="text-sm">Loading case...</p>
        </div>
      </div>
    )
  }

  if (error || !caseData) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
          <h2 className="mt-4 text-lg font-semibold text-foreground/80">
            Case not found
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "The case you're looking for doesn't exist."}
          </p>
        </div>
      </div>
    )
  }

  return <CaseHero caseData={caseData} />
}

export default function CasePage() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <div className="relative min-h-screen bg-background">
          <div className="fixed inset-0 bg-grid mask-radial pointer-events-none" />
          <div className="relative">
            <Navbar />
            <CaseContent />
          </div>
        </div>
      </EngineProvider>
    </ThemeProvider>
  )
}
