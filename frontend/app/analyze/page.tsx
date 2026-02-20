"use client"

import { useState } from "react"
import { Navbar } from "@/components/layout/navbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
  Upload,
  Github,
  Cloud,
  FileCode,
  CheckCircle2,
  Loader2,
  ArrowRight,
} from "lucide-react"

export default function AnalyzePage() {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)

  const handleStartAnalysis = () => {
    setIsAnalyzing(true)
    setAnalysisProgress(0)

    // Simulate analysis progress
    const interval = setInterval(() => {
      setAnalysisProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        return prev + 10
      })
    }, 500)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <Navbar />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Analyze Your Application</h1>
          <p className="text-muted-foreground">
            Connect your codebase or deployment to get started with scaling analysis
          </p>
        </div>

        {!isAnalyzing ? (
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Upload Code</TabsTrigger>
              <TabsTrigger value="github">GitHub Repo</TabsTrigger>
              <TabsTrigger value="cloud">Cloud Deployment</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Your Codebase</CardTitle>
                  <CardDescription>
                    Upload a zip file of your application code
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed rounded-lg p-12 text-center">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Drag and drop your codebase here, or click to browse
                    </p>
                    <Button variant="outline">
                      <FileCode className="h-4 w-4 mr-2" />
                      Select Files
                    </Button>
                    <p className="text-xs text-muted-foreground mt-4">
                      Supported: .zip, .tar.gz (max 100MB)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="github" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Connect GitHub Repository</CardTitle>
                  <CardDescription>
                    Link your GitHub repository for automatic analysis
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Repository URL</label>
                    <input
                      type="text"
                      placeholder="https://github.com/username/repo"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Branch</label>
                    <input
                      type="text"
                      placeholder="main"
                      className="w-full px-3 py-2 border rounded-md"
                    />
                  </div>
                  <Button className="w-full">
                    <Github className="h-4 w-4 mr-2" />
                    Connect Repository
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cloud" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Connect Cloud Deployment</CardTitle>
                  <CardDescription>
                    Link your existing AWS, GCP, or Azure deployment
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    <Button variant="outline" className="justify-start">
                      <Cloud className="h-4 w-4 mr-2" />
                      AWS
                    </Button>
                    <Button variant="outline" className="justify-start">
                      <Cloud className="h-4 w-4 mr-2" />
                      Google Cloud Platform
                    </Button>
                    <Button variant="outline" className="justify-start">
                      <Cloud className="h-4 w-4 mr-2" />
                      Microsoft Azure
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    We'll use read-only access to analyze your infrastructure
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Analyzing Your Application</CardTitle>
              <CardDescription>
                Profiling workloads and generating architecture recommendations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Analysis Progress</span>
                  <span>{analysisProgress}%</span>
                </div>
                <Progress value={analysisProgress} />
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  {analysisProgress > 10 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-sm">Scanning codebase structure</span>
                </div>
                <div className="flex items-center space-x-3">
                  {analysisProgress > 30 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-sm">Profiling latency distribution</span>
                </div>
                <div className="flex items-center space-x-3">
                  {analysisProgress > 50 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-sm">Analyzing read/write patterns</span>
                </div>
                <div className="flex items-center space-x-3">
                  {analysisProgress > 70 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-sm">Identifying hot endpoints</span>
                </div>
                <div className="flex items-center space-x-3">
                  {analysisProgress > 90 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  )}
                  <span className="text-sm">Generating architecture plan</span>
                </div>
              </div>

              {analysisProgress >= 100 && (
                <Button className="w-full" size="lg" asChild>
                  <a href="/dashboard">
                    View Results
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!isAnalyzing && (
          <div className="mt-6 flex justify-center">
            <Button size="lg" onClick={handleStartAnalysis}>
              Start Analysis
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}

        {/* Info Section */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>What We Analyze</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Latency Distribution</p>
                  <p className="text-muted-foreground">
                    p50, p95, p99 percentiles and tail latency patterns
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Read/Write Mix</p>
                  <p className="text-muted-foreground">
                    Database query patterns and access frequency
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Hot Endpoints</p>
                  <p className="text-muted-foreground">
                    Identify high-traffic routes and bottlenecks
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Fanout Patterns</p>
                  <p className="text-muted-foreground">
                    Service dependencies and communication patterns
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
