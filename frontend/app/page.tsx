"use client"

import { EngineProvider, useEngine } from "@/lib/engine"
import { ThemeProvider } from "@/lib/theme"
import { Navbar } from "@/components/layout/navbar"
import { InvestigatePage } from "@/components/investigate/investigate-page"
import { IncidentHero } from "@/components/investigate/incident-hero"

function AppContent() {
  const { state } = useEngine()

  return (
    <div className="relative min-h-screen bg-background">
      {/* Background grid */}
      <div className="fixed inset-0 bg-grid mask-radial pointer-events-none" />

      <div className="relative">
        <Navbar />

        {state.status === "idle" ? (
          <IncidentHero />
        ) : (
          <InvestigatePage />
        )}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <ThemeProvider>
      <EngineProvider>
        <AppContent />
      </EngineProvider>
    </ThemeProvider>
  )
}
