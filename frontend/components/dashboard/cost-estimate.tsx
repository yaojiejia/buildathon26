import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, TrendingDown } from "lucide-react"

interface CostBreakdown {
  service: string
  cost: number
  percentage: number
}

interface CostEstimateProps {
  totalCost?: number
  previousCost?: number
  breakdown?: CostBreakdown[]
}

const defaultBreakdown: CostBreakdown[] = [
  { service: "Compute (EC2/Compute Engine)", cost: 450, percentage: 45 },
  { service: "Database (RDS/Cloud SQL)", cost: 200, percentage: 20 },
  { service: "Load Balancer", cost: 150, percentage: 15 },
  { service: "Cache (ElastiCache/Memorystore)", cost: 100, percentage: 10 },
  { service: "Queue (SQS/Pub/Sub)", cost: 50, percentage: 5 },
  { service: "Storage & CDN", cost: 50, percentage: 5 },
]

export function CostEstimate({
  totalCost = 1000,
  previousCost = 1500,
  breakdown = defaultBreakdown,
}: CostEstimateProps) {
  const savings = previousCost - totalCost
  const savingsPercent = ((savings / previousCost) * 100).toFixed(1)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Monthly Cost Estimate</CardTitle>
            <CardDescription>Optimized cloud infrastructure costs</CardDescription>
          </div>
          <DollarSign className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline space-x-2">
          <span className="text-3xl font-bold">${totalCost.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">/month</span>
        </div>

        {previousCost && savings > 0 && (
          <div className="flex items-center space-x-2 text-green-600">
            <TrendingDown className="h-4 w-4" />
            <span className="text-sm font-medium">
              ${savings.toLocaleString()} saved ({savingsPercent}% reduction)
            </span>
          </div>
        )}

        <div className="space-y-2 pt-4 border-t">
          <h4 className="text-sm font-semibold">Cost Breakdown</h4>
          {breakdown.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{item.service}</span>
                <span className="font-medium">${item.cost}/mo</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
