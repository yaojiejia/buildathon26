"use client"

import { EngineProvider, useEngine } from "@/lib/engine"
import { Navbar } from "@/components/layout/navbar"
import { WarRoom } from "@/components/warroom/war-room"
import { IncidentHero } from "@/components/warroom/incident-hero"

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
          <WarRoom />
        )}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <EngineProvider>
      <AppContent />
    </EngineProvider>
  )
}
