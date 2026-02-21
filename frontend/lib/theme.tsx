"use client"

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

type Theme = "light" | "dark"

interface ThemeContext {
  theme: Theme
  toggleTheme: () => void
}

const Ctx = createContext<ThemeContext | null>(null)

export function useTheme(): ThemeContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark")

  useEffect(() => {
    const stored = localStorage.getItem("bugpilot-theme") as Theme | null
    if (stored) setTheme(stored)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    localStorage.setItem("bugpilot-theme", theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"))
  }, [])

  return (
    <Ctx.Provider value={{ theme, toggleTheme }}>
      {children}
    </Ctx.Provider>
  )
}
