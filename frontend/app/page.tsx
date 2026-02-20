"use client"

import { Navbar } from "@/components/layout/navbar"
import LandingPage from "@/components/ui/landing-page"

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <Navbar />
      <LandingPage />
    </div>
  )
}
