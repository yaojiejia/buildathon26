import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Gauge, Clock, Activity } from "lucide-react"

interface LatencyMetric {
  percentile: string
  value: number
  target: number
}

interface PerformanceMetricsProps {
  p50?: number
  p95?: number
  p99?: number
  throughput?: number
  errorRate?: number
}

export function PerformanceMetrics({
  p50 = 45,
  p95 = 120,
  p99 = 250,
  throughput = 1250,
  errorRate = 0.12,
}: PerformanceMetricsProps) {
  const latencyMetrics: LatencyMetric[] = [
    { percentile: "p50", value: p50, target: 50 },
    { percentile: "p95", value: p95, target: 100 },
    { percentile: "p99", value: p99, target: 200 },
  ]

  const getStatusColor = (value: number, target: number) => {
    if (value <= target) return "text-green-600"
    if (value <= target * 1.5) return "text-yellow-600"
    return "text-red-600"
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
        <CardDescription>Real-time latency and throughput measurements</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="latency" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="latency">Latency</TabsTrigger>
            <TabsTrigger value="throughput">Throughput</TabsTrigger>
          </TabsList>

          <TabsContent value="latency" className="space-y-4 mt-4">
            <div className="grid gap-4">
              {latencyMetrics.map((metric) => (
                <div key={metric.percentile} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{metric.percentile}</span>
                    </div>
                    <span
                      className={`text-sm font-bold ${getStatusColor(
                        metric.value,
                        metric.target
                      )}`}
                    >
                      {metric.value}ms
                    </span>
                  </div>
                  <Progress
                    value={(metric.value / (metric.target * 2)) * 100}
                    className="h-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Target: {metric.target}ms</span>
                    <span>
                      {metric.value <= metric.target ? "✓ Within target" : "⚠ Above target"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="throughput" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Requests/sec</span>
                </div>
                <span className="text-lg font-bold">{throughput.toLocaleString()}</span>
              </div>
              <Progress value={75} className="h-2" />

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center space-x-2">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Error Rate</span>
                </div>
                <span
                  className={`text-sm font-bold ${
                    errorRate < 0.5 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {errorRate}%
                </span>
              </div>
              <Progress value={errorRate * 10} className="h-2" />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
