"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

export function Navbar() {
  const pathname = usePathname()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04]">
      <div className="absolute inset-0 bg-[#0a0b10]/80 backdrop-blur-2xl" />
      <div className="relative max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold text-white/90 tracking-tight">
            ScaleAgent
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {[
            { href: "/", label: "Home" },
            { href: "/dashboard", label: "Dashboard" },
            { href: "/analyze", label: "Analyze" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors",
                pathname === item.href
                  ? "text-white bg-white/[0.06]"
                  : "text-white/40 hover:text-white/70"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/analyze"
          className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-white text-black hover:bg-white/90 transition-colors"
        >
          Get Started
        </Link>
      </div>
    </header>
  )
}
