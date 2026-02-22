"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { EngineProvider } from "@/lib/engine"
import { ThemeProvider } from "@/lib/theme"
import { Navbar } from "@/components/layout/navbar"
import { GlowingEffect } from "@/components/ui/glowing-effect"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  Github,
  Clock,
  Inbox,
  Loader2,
  ArrowRight,
} from "lucide-react"

interface CaseSummary {
  id: string
  state: string
  title: string
  repo: string
  sourceType: string
  createdAt: string
}

function stateColor(state: string) {
  switch (state) {
    case "NEW":
      return "bg-cyan-500/15 text-cyan-400"
    case "INVESTIGATING":
      return "bg-amber-500/15 text-amber-400"
    case "RESOLVED":
      return "bg-emerald-500/15 text-emerald-400"
    default:
      return "bg-white/[0.06] text-muted-foreground"
  }
}

function Dashboard() {
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchCases() {
      try {
        const res = await fetch("/api/cases")
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? "Failed to load cases")
          return
        }
        setCases(data.cases ?? [])
      } catch {
        setError("Failed to connect to server")
      } finally {
        setLoading(false)
      }
    }
    fetchCases()
  }, [])

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <p className="text-sm">Loading cases...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
          <h2 className="mt-4 text-lg font-semibold text-foreground/80">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (cases.length === 0) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center max-w-md">
          <Inbox className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <h2 className="mt-5 text-xl font-semibold text-foreground/80">
            No cases yet
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Cases are created automatically when a GitHub issue is opened via
            webhook. Open an issue in a connected repo to get started.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight text-foreground/90">
        Cases
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {cases.length} case{cases.length !== 1 ? "s" : ""} from GitHub webhooks
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {cases.map((c) => (
          <Link key={c.id} href={`/case/${c.id}`}>
            <div className="group relative rounded-xl">
              <GlowingEffect
                spread={30}
                glow={true}
                disabled={false}
                proximity={80}
                inactiveZone={0.01}
                borderWidth={1}
              />
              <div
                className={cn(
                  "relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-5",
                  "transition-colors hover:bg-white/[0.04] hover:border-white/[0.1]",
                  "cursor-pointer"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                          stateColor(c.state)
                        )}
                      >
                        {c.state}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-foreground/90 truncate">
                      {c.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Github className="h-3 w-3" />
                        {c.repo}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-cyan-400 transition-colors mt-1 shrink-0" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <div className="relative min-h-screen bg-background">
          <div className="fixed inset-0 bg-grid mask-radial pointer-events-none" />
          <div className="relative">
            <Navbar hideInvestigate />
            <Dashboard />
          </div>
        </div>
      </EngineProvider>
    </ThemeProvider>
  )
}
