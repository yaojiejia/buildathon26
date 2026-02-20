import { Navbar } from "@/components/layout/navbar"
import { MetricCard } from "@/components/dashboard/metric-card"
import { ArchitectureDiagram } from "@/components/dashboard/architecture-diagram"
import { CostEstimate } from "@/components/dashboard/cost-estimate"
import { PerformanceMetrics } from "@/components/dashboard/performance-metrics"
import {
  Server,
  TrendingUp,
  AlertCircle,
  Zap,
  Database,
  Activity,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <Navbar />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor your distributed system performance and costs
          </p>
        </div>

        {/* Metrics Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <MetricCard
            title="Total Requests"
            value="2.4M"
            change="+12.5% from last month"
            trend="up"
            icon={Activity}
          />
          <MetricCard
            title="Avg Latency (p95)"
            value="120ms"
            change="-15ms improved"
            trend="up"
            icon={Zap}
          />
          <MetricCard
            title="Uptime"
            value="99.97%"
            change="+0.02% from last month"
            trend="up"
            icon={Server}
          />
          <MetricCard
            title="Active Services"
            value="8"
            change="2 new services"
            trend="neutral"
            icon={Database}
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-6">
          <div className="lg:col-span-2">
            <ArchitectureDiagram />
          </div>
          <div>
            <PerformanceMetrics />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <CostEstimate />
          <Card>
            <CardHeader>
              <CardTitle>Recent Deployments</CardTitle>
              <CardDescription>Latest infrastructure changes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <p className="font-medium">Added Redis Cache</p>
                    <p className="text-sm text-muted-foreground">2 hours ago</p>
                  </div>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Success
                  </span>
                </div>
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <p className="font-medium">Scaled App Servers</p>
                    <p className="text-sm text-muted-foreground">1 day ago</p>
                  </div>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Success
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Database Replication</p>
                    <p className="text-sm text-muted-foreground">3 days ago</p>
                  </div>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Success
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recommendations */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Optimization Recommendations</CardTitle>
            <CardDescription>
              AI-generated suggestions to improve performance and reduce costs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start space-x-4 p-4 border rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold mb-1">Enable Request Batching</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Batch database queries to reduce round trips. Expected improvement: 30% latency
                    reduction on read-heavy endpoints.
                  </p>
                  <button className="text-sm text-primary hover:underline">
                    Apply recommendation →
                  </button>
                </div>
              </div>
              <div className="flex items-start space-x-4 p-4 border rounded-lg">
                <Zap className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold mb-1">Add Connection Pooling</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Implement connection pooling for database connections. Expected improvement: 40%
                    reduction in connection overhead.
                  </p>
                  <button className="text-sm text-primary hover:underline">
                    Apply recommendation →
                  </button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
