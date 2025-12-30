// Health server for DigitalOcean App Platform Debug Container
// This lightweight Go server keeps the container alive and provides health checks
// even when the main application isn't running.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Container string `json:"container"`
	Runtime   string `json:"runtime,omitempty"`
}

type InfoResponse struct {
	Service     string            `json:"service"`
	Description string            `json:"description"`
	Container   string            `json:"container"`
	Runtime     string            `json:"runtime"`
	Endpoints   map[string]string `json:"endpoints"`
	Scripts     map[string]string `json:"scripts"`
	Timestamp   string            `json:"timestamp"`
}

func getContainerType() string {
	if val := os.Getenv("DEBUG_CONTAINER_TYPE"); val != "" {
		return val
	}
	return "debug"
}

func getRuntimeType() string {
	if val := os.Getenv("DEBUG_RUNTIME"); val != "" {
		return val
	}
	// Auto-detect
	if _, err := exec.LookPath("node"); err == nil {
		return "node"
	}
	if _, err := exec.LookPath("python3"); err == nil {
		return "python"
	}
	return "unknown"
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	response := HealthResponse{
		Status:    "healthy",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Container: getContainerType(),
		Runtime:   getRuntimeType(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func infoHandler(w http.ResponseWriter, r *http.Request) {
	response := InfoResponse{
		Service:     "do-app-debug-container",
		Description: "Debug container for DigitalOcean App Platform troubleshooting",
		Container:   getContainerType(),
		Runtime:     getRuntimeType(),
		Endpoints: map[string]string{
			"/":       "This info page",
			"/health": "Health check endpoint",
		},
		Scripts: map[string]string{
			"/app/scripts/diagnose.sh":          "Full system diagnostic report",
			"/app/scripts/test-db.sh":           "Database connectivity test (postgres|mysql|redis|mongodb|kafka|opensearch)",
			"/app/scripts/test-connectivity.sh": "Network connectivity test",
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func printStartupBanner(port string, runtimeType string) {
	banner := `
================================================================================
  DigitalOcean App Platform Debug Container
================================================================================

  Runtime: %s
  Health Server: http://0.0.0.0:%s

  AVAILABLE DIAGNOSTIC SCRIPTS:
  ─────────────────────────────────────────────────────────────────────────────
  /app/scripts/diagnose.sh              Full system diagnostic report
  /app/scripts/test-db.sh <type>        Database connectivity test
                                        Types: postgres, mysql, redis, mongodb,
                                               kafka, opensearch
  /app/scripts/test-connectivity.sh     Network connectivity test

  QUICK COMMANDS:
  ─────────────────────────────────────────────────────────────────────────────
  diagnose.sh                           Run full diagnostics
  test-db.sh postgres                   Test PostgreSQL connection
  test-db.sh redis                      Test Redis/Valkey connection
  test-connectivity.sh https://api.com  Test HTTP connectivity
  test-connectivity.sh db.example.com 5432  Test TCP connectivity

  ENVIRONMENT VARIABLES FOR DATABASE TESTING:
  ─────────────────────────────────────────────────────────────────────────────
  DATABASE_URL      PostgreSQL connection string
  REDIS_URL         Redis/Valkey connection string
  MONGODB_URI       MongoDB connection string
  KAFKA_BROKERS     Kafka broker addresses
  OPENSEARCH_URL    OpenSearch endpoint

  ACCESS SHELL:
  ─────────────────────────────────────────────────────────────────────────────
  doctl apps console <app-id> <component-name>

================================================================================
`
	runtimeDisplay := strings.ToUpper(runtimeType)
	if runtimeType == "node" {
		runtimeDisplay = "Node.js"
	} else if runtimeType == "python" {
		runtimeDisplay = "Python"
	}
	fmt.Printf(banner, runtimeDisplay, port)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	runtimeType := getRuntimeType()
	printStartupBanner(port, runtimeType)

	http.HandleFunc("/", infoHandler)
	http.HandleFunc("/health", healthHandler)

	log.Printf("Health server starting on port %s (Go %s)", port, runtime.Version())
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
