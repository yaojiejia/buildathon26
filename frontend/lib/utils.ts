import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const MAX_CASE_TITLE_LEN = 80

/**
 * Shorten a case title to a readable length (word-boundary aware).
 */
export function summarizeTitle(text: string): string {
  const t = text.trim()
  if (!t) return "Untitled"
  if (t.length <= MAX_CASE_TITLE_LEN) return t
  const cut = t.slice(0, MAX_CASE_TITLE_LEN)
  const lastSpace = cut.lastIndexOf(" ")
  const end = lastSpace > 40 ? lastSpace : MAX_CASE_TITLE_LEN - 3
  return t.slice(0, end).trim() + "…"
}
