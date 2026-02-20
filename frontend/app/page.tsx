import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Server, Zap, TrendingUp, Shield } from "lucide-react"
import { Navbar } from "@/components/layout/navbar"

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <Navbar />

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-6xl font-bold mb-4">
            Scale Your App Without
            <br />
            <span className="text-primary">Becoming a Distributed Systems Engineer</span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Transform your single-server application into a production-grade distributed system
            on AWS/GCP/Azure. Get replication, consensus, networking, and observability—without
            the complexity tax.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" asChild>
              <Link href="/analyze">Start Analysis</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/dashboard">View Demo</Link>
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card>
            <CardHeader>
              <Zap className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Performance Mode</CardTitle>
              <CardDescription>
                Optimize for p95/p99 latency and throughput with intelligent bottleneck removal
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <TrendingUp className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Incremental Scaling</CardTitle>
              <CardDescription>
                Smallest set of changes that meaningfully improve scaling and uptime
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Managed Services</CardTitle>
              <CardDescription>
                Defaults to cloud-native managed services when safer and cheaper
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Server className="h-8 w-8 text-primary mb-2" />
              <CardTitle>Cost Optimized</CardTitle>
              <CardDescription>
                Continuously estimates cloud spend and recommends the cheapest architecture
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* How It Works */}
        <Card className="mb-16">
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>
              From your existing code to a production-grade distributed system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                    1
                  </div>
                  <h3 className="font-semibold">Profile Workloads</h3>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Analyze latency distribution, burstiness, read/write mix, hot endpoints, and fanout patterns
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                    2
                  </div>
                  <h3 className="font-semibold">Generate Plan</h3>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Create an incremental architecture plan with the smallest set of meaningful changes
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                    3
                  </div>
                  <h3 className="font-semibold">Execute & Deploy</h3>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Execute the plan with reproducible deployments and reviewable diffs
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Distributed Systems Engineering as a Product</p>
        </div>
      </footer>
    </div>
  )
}
