import React from "react"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string
  variant?: "primary" | "secondary"
}

const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(
  (
    {
      text = "Button",
      variant = "primary",
      className,
      children,
      ...props
    },
    ref
  ) => {
    const isPrimary = variant === "primary"
    return (
      <button
        ref={ref}
        className={cn(
          "group/btn relative flex w-full min-w-32 cursor-pointer items-center justify-center overflow-hidden rounded-xl border p-2 text-center text-sm font-semibold",
          isPrimary &&
            "border-cyan-500/20 bg-cyan-500/10 text-cyan-300 active:scale-[0.98]",
          !isPrimary &&
            "border-violet-500/40 bg-violet-500/10 text-violet-300 active:scale-[0.98]",
          className
        )}
        {...props}
      >
        <span className="inline-flex items-center gap-2 transition-all duration-300 group-hover/btn:translate-x-12 group-hover/btn:opacity-0">
          {children}
          {text}
        </span>
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 opacity-0 transition-all duration-300 group-hover/btn:-translate-x-1 group-hover/btn:opacity-100",
            isPrimary ? "text-cyan-300" : "text-violet-300"
          )}
        >
          <span>{text}</span>
          <ArrowRight className="h-4 w-4" />
        </div>
      </button>
    )
  }
)

InteractiveHoverButton.displayName = "InteractiveHoverButton"

export { InteractiveHoverButton }
