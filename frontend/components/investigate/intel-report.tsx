"use client"

import { cn } from "@/lib/utils"
import { useEngine } from "@/lib/engine"
import { agentMeta } from "@/lib/agent-data"
import { ALL_AGENT_IDS, AgentId, InvestigationReport } from "@/lib/types"
import {
  Shield,
  FileCode2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ScrollText,
  Search,
  BookOpen,
  Wrench,
} from "lucide-react"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Search,
  BookOpen,
  ScrollText,
  Wrench,
  Shield,
}

function agentSummaryFromReport(agentId: AgentId, report: InvestigationReport): string {
  switch (agentId) {
    case "triage":
      return report.triage?.summary || "No triage data"
    case "codebase_search":
      return report.investigation?.reasoning
        ? report.investigation.reasoning.slice(0, 200) + (report.investigation.reasoning.length > 200 ? "…" : "")
        : "No investigation data"
    case "doc_analysis":
      return report.documentation?.reasoning
        ? report.documentation.reasoning.slice(0, 200) + (report.documentation.reasoning.length > 200 ? "…" : "")
        : "No documentation data"
    case "log_analysis":
      if (report.log_analysis?.error) return report.log_analysis.error
      return report.log_analysis?.timeline || "No log data"
    case "patch_generation":
      if (report.patch_generation?.status === "ok" && report.patch_generation?.pr_title)
        return report.patch_generation.pr_title
      if (report.patch_generation?.error) return `Failed: ${report.patch_generation.error}`
      return report.patch_generation?.status || "No patch data"
    default:
      return "Completed"
  }
}

function agentFindingFromEvents(events: { message: string; type: string }[]): string {
  const findings = events.filter(e => e.type === "finding" || e.type === "success")
  if (findings.length > 0) return findings[findings.length - 1].message
  const results = events.filter(e => e.type === "result" || e.type === "complete")
  if (results.length > 0) return results[results.length - 1].message
  return "Completed"
}

function ConfidenceBadge({ level }: { level: string }) {
  const normalized = level.toLowerCase()
  const colorMap: Record<string, { border: string; bg: string; text: string }> = {
    high: { border: "border-emerald-400/50", bg: "bg-emerald-400/10", text: "text-emerald-400" },
    medium: { border: "border-amber-400/50", bg: "bg-amber-400/10", text: "text-amber-400" },
    low: { border: "border-orange-400/50", bg: "bg-orange-400/10", text: "text-orange-400" },
    none: { border: "border-red-400/50", bg: "bg-red-400/10", text: "text-red-400" },
  }
  const colors = colorMap[normalized] || colorMap.medium
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1)

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-full border-2", colors.border, colors.bg)}>
        <span className={cn("text-sm font-bold", colors.text)}>
          {normalized.charAt(0).toUpperCase()}
        </span>
      </div>
      <div>
        <p className="text-xs font-medium text-foreground/80">{label} Confidence</p>
        <p className="text-[11px] text-muted-foreground">
          Investigation confidence: {normalized}
        </p>
      </div>
    </div>
  )
}

export function IntelReport() {
  const { state } = useEngine()
  const report = state.report

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3">
        <Shield className="h-4 w-4 text-emerald-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Gathered Intelligence
        </h2>
      </div>

      {/* Scrollable report body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Status banner */}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <p className="text-sm font-semibold text-emerald-400">
            Investigation Complete
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            {ALL_AGENT_IDS.length} agents completed analysis
            {report?.issue?.title && (
              <>
                {" "}for{" "}
                <span className="text-foreground/80 font-medium">{report.issue.title}</span>
              </>
            )}
          </p>
        </div>

        {/* Triage Summary */}
        {report?.triage && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Triage
            </h3>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  report.triage.severity === "critical" && "bg-red-500/20 text-red-400",
                  report.triage.severity === "high" && "bg-amber-500/20 text-amber-400",
                  report.triage.severity === "medium" && "bg-yellow-500/20 text-yellow-400",
                  report.triage.severity === "low" && "bg-blue-500/20 text-blue-400",
                )}>
                  <AlertTriangle className="inline h-2.5 w-2.5 mr-0.5" />
                  {report.triage.severity}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Module: {report.triage.likely_module}
                </span>
                {report.triage.is_duplicate && (
                  <span className="text-[10px] text-orange-400">DUPLICATE</span>
                )}
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed">
                {report.triage.summary}
              </p>
            </div>
          </section>
        )}

        {/* Agent contributions */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agent Contributions
          </h3>
          <div className="space-y-1.5">
            {ALL_AGENT_IDS.map((agentId) => {
              const meta = agentMeta[agentId]
              const agent = state.agents[agentId]
              const Icon = iconMap[meta.icon]
              const summary = report
                ? agentSummaryFromReport(agentId, report)
                : agentFindingFromEvents(agent.events)
              return (
                <div
                  key={agentId}
                  className="rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", meta.color)} />}
                    <span className="text-xs font-semibold text-foreground/80">{meta.name}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {summary}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Root cause / Investigation reasoning */}
        {report?.investigation?.reasoning && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Root Cause Analysis
            </h3>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-foreground/75 leading-relaxed whitespace-pre-line">
              {report.investigation.reasoning}
            </div>
          </section>
        )}

        {/* Suspect files / Evidence */}
        {report?.investigation?.suspect_files && report.investigation.suspect_files.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suspect Files
            </h3>
            <div className="space-y-1.5">
              {report.investigation.suspect_files.map((file, i) => (
                <div
                  key={i}
                  className="rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <FileCode2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-cyan-400" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground/80 break-all">
                        {file.file_path}
                        {file.lines_referenced?.length > 0 && (
                          <span className="text-muted-foreground ml-1">
                            (line{file.lines_referenced.length > 1 ? "s" : ""} {file.lines_referenced.join(", ")})
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                        {file.why_relevant}
                      </p>
                      {file.snippet && (
                        <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-white/[0.04] bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {file.snippet}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Documentation */}
        {report?.documentation?.relevant_docs && report.documentation.relevant_docs.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Relevant Documentation
            </h3>
            <div className="space-y-1.5">
              {report.documentation.relevant_docs.map((doc, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5"
                >
                  <BookOpen className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-400" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground/70">{doc.file_path}</p>
                    <p className="text-[10px] text-muted-foreground">{doc.why_relevant}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Log Analysis */}
        {report?.log_analysis && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Log Analysis
            </h3>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-foreground/75 leading-relaxed">
              {report.log_analysis.error ? (
                <p className="text-orange-400/80">{report.log_analysis.error}</p>
              ) : (
                <>
                  <p>{report.log_analysis.timeline}</p>
                  {report.log_analysis.suspicious_logs.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {report.log_analysis.suspicious_logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <ScrollText className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400" />
                          <div>
                            <p className="text-[11px] text-foreground/70">{log.message}</p>
                            <p className="text-[10px] text-muted-foreground">{log.why_suspicious}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {report.log_analysis.patterns_found.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] font-medium text-foreground/70">Patterns:</p>
                      {report.log_analysis.patterns_found.map((p, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground">• {p}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Events scanned: {report.log_analysis.total_events_scanned}
              </p>
            </div>
          </section>
        )}

        {/* Confidence */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Confidence
          </h3>
          <ConfidenceBadge level={report?.investigation?.confidence || "medium"} />
        </section>

        {/* Patch Generation */}
        {report?.patch_generation && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Patch Generation
            </h3>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-2">
                {report.patch_generation.status === "ok" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                )}
                <span className={cn(
                  "text-xs font-medium",
                  report.patch_generation.status === "ok" ? "text-emerald-400" : "text-amber-400"
                )}>
                  {report.patch_generation.status === "ok" ? "Patch Generated" : `Status: ${report.patch_generation.status}`}
                </span>
              </div>

              {report.patch_generation.pr_title && (
                <p className="text-[11px] text-foreground/70">{report.patch_generation.pr_title}</p>
              )}

              {report.patch_generation.changed_files?.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-[10px] font-medium text-muted-foreground">Changed files:</p>
                  {report.patch_generation.changed_files?.map((f, i) => (
                    <p key={i} className="text-[10px] text-foreground/60 font-mono">• {f}</p>
                  ))}
                </div>
              )}

              {report.patch_generation.diff && (
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-white/[0.04] bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground max-h-48">
                  {report.patch_generation.diff}
                </pre>
              )}

              {report.patch_generation.error && (
                <p className="text-[11px] text-orange-400/80">{report.patch_generation.error}</p>
              )}

              {report.patch_generation.draft_pr?.status === "created" && report.patch_generation.draft_pr.url && (
                <a
                  href={report.patch_generation.draft_pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Pull Request
                </a>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.06] p-4">
        {report?.patch_generation?.draft_pr?.status === "created" && report.patch_generation.draft_pr.url ? (
          <div className="flex gap-2">
            <a
              href={report.patch_generation.draft_pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium",
                "bg-white/[0.06] text-foreground/90 border border-white/[0.1]",
                "transition-all hover:bg-white/[0.1] hover:border-white/[0.15]"
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View PR
            </a>
            <button className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium",
              "bg-white/[0.06] text-foreground/90 border border-white/[0.1]",
              "transition-all hover:bg-white/[0.1] hover:border-white/[0.15]"
            )}>
              <ArrowRight className="h-3.5 w-3.5" />
              Open in Cursor
            </button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-muted-foreground/50">
            {report?.patch_generation?.status === "failed"
              ? "Patch generation failed — review findings above"
              : "Investigation report generated from backend pipeline"}
          </p>
        )}
      </div>
    </div>
  )
}
