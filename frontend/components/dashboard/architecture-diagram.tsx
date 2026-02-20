"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Server, Database, LoadBalancer, Cloud } from "lucide-react"

interface Node {
  id: string
  label: string
  type: "server" | "database" | "loadbalancer" | "cache" | "queue"
  x: number
  y: number
}

interface Connection {
  from: string
  to: string
}

interface ArchitectureDiagramProps {
  nodes?: Node[]
  connections?: Connection[]
}

const defaultNodes: Node[] = [
  { id: "lb", label: "Load Balancer", type: "loadbalancer", x: 50, y: 20 },
  { id: "app1", label: "App Server 1", type: "server", x: 20, y: 50 },
  { id: "app2", label: "App Server 2", type: "server", x: 50, y: 50 },
  { id: "app3", label: "App Server 3", type: "server", x: 80, y: 50 },
  { id: "db", label: "Database", type: "database", x: 50, y: 80 },
  { id: "cache", label: "Cache", type: "cache", x: 20, y: 80 },
  { id: "queue", label: "Queue", type: "queue", x: 80, y: 80 },
]

const defaultConnections: Connection[] = [
  { from: "lb", to: "app1" },
  { from: "lb", to: "app2" },
  { from: "lb", to: "app3" },
  { from: "app1", to: "db" },
  { from: "app2", to: "db" },
  { from: "app3", to: "db" },
  { from: "app1", to: "cache" },
  { from: "app2", to: "cache" },
  { from: "app3", to: "cache" },
  { from: "app1", to: "queue" },
  { from: "app2", to: "queue" },
]

const iconMap = {
  server: Server,
  database: Database,
  loadbalancer: LoadBalancer,
  cache: Database,
  queue: Cloud,
}

export function ArchitectureDiagram({
  nodes = defaultNodes,
  connections = defaultConnections,
}: ArchitectureDiagramProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Architecture</CardTitle>
        <CardDescription>Visual representation of your distributed system</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative w-full h-[400px] border rounded-lg bg-muted/20">
          <svg className="w-full h-full">
            {/* Render connections */}
            {connections.map((conn, idx) => {
              const fromNode = nodes.find((n) => n.id === conn.from)
              const toNode = nodes.find((n) => n.id === conn.to)
              if (!fromNode || !toNode) return null

              const x1 = (fromNode.x / 100) * 100
              const y1 = (fromNode.y / 100) * 100
              const x2 = (toNode.x / 100) * 100
              const y2 = (toNode.y / 100) * 100

              return (
                <line
                  key={idx}
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth="2"
                  strokeDasharray="4,4"
                />
              )
            })}

            {/* Render nodes */}
            {nodes.map((node) => {
              const Icon = iconMap[node.type]
              const x = (node.x / 100) * 100
              const y = (node.y / 100) * 100

              return (
                <g key={node.id} transform={`translate(${x}%, ${y}%)`}>
                  <foreignObject x="-40" y="-30" width="80" height="60">
                    <div className="flex flex-col items-center">
                      <div className="p-2 bg-background border rounded-lg shadow-sm">
                        <Icon className="h-6 w-6 text-primary" />
                      </div>
                      <span className="text-xs mt-1 text-center font-medium">
                        {node.label}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              )
            })}
          </svg>
        </div>
      </CardContent>
    </Card>
  )
}
