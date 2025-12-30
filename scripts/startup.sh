#!/bin/bash
# Startup script for DigitalOcean App Platform Debug Container
# Displays helpful information and starts the health server

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Get runtime info
RUNTIME="${DEBUG_RUNTIME:-unknown}"
CONTAINER_TYPE="${DEBUG_CONTAINER_TYPE:-debug}"
PORT="${PORT:-8080}"

print_banner() {
    echo ""
    echo -e "${CYAN}================================================================================${NC}"
    echo -e "${BOLD}  DigitalOcean App Platform Debug Container${NC}"
    echo -e "${CYAN}================================================================================${NC}"
    echo ""
}

print_runtime_info() {
    echo -e "${BOLD}RUNTIME INFORMATION${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"

    if [ "$RUNTIME" = "python" ]; then
        echo -e "  Runtime:    ${GREEN}Python${NC}"
        python3 --version 2>/dev/null | sed 's/^/  Version:    /'
    elif [ "$RUNTIME" = "node" ]; then
        echo -e "  Runtime:    ${GREEN}Node.js${NC}"
        node --version 2>/dev/null | sed 's/^/  Version:    /'
    else
        echo -e "  Runtime:    ${YELLOW}Unknown${NC}"
    fi

    echo -e "  Container:  ${CONTAINER_TYPE}"
    echo -e "  Health:     http://0.0.0.0:${PORT}/health"
    echo ""
}

print_database_clients() {
    echo -e "${BOLD}INSTALLED DATABASE CLIENTS${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"

    # PostgreSQL
    if command -v psql &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} PostgreSQL  (psql)"
    fi

    # MySQL
    if command -v mysql &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} MySQL       (mysql)"
    fi

    # Redis/Valkey
    if command -v redis-cli &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Redis/Valkey (redis-cli)"
    fi

    # MongoDB
    if command -v mongosh &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} MongoDB     (mongosh)"
    fi

    # Kafka
    if command -v kcat &> /dev/null || command -v kafkacat &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Kafka       (kcat/kafkacat)"
    fi

    # OpenSearch (via curl + jq)
    if command -v curl &> /dev/null && command -v jq &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} OpenSearch  (curl + jq)"
    fi

    # Spaces (S3-compatible)
    echo -e "  ${GREEN}✓${NC} Spaces      (boto3/aws-sdk)"
    echo ""
}

print_tools() {
    echo -e "${BOLD}INSTALLED TOOLS${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"

    # doctl
    if command -v doctl &> /dev/null; then
        DOCTL_VERSION=$(doctl version 2>/dev/null | head -1 | awk '{print $3}' || echo "installed")
        echo -e "  ${GREEN}✓${NC} doctl       (v${DOCTL_VERSION})"
    fi

    echo ""
}

print_diagnostic_scripts() {
    echo -e "${BOLD}DIAGNOSTIC SCRIPTS${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"
    echo -e "  ${CYAN}diagnose.sh${NC}"
    echo -e "      Full system diagnostic report (memory, disk, network, env vars)"
    echo ""
    echo -e "  ${CYAN}test-db.sh <type>${NC}"
    echo -e "      Test database connectivity"
    echo -e "      Types: postgres, mysql, redis, mongodb, kafka, opensearch"
    echo ""
    echo -e "  ${CYAN}test-spaces.sh${NC}"
    echo -e "      Test DigitalOcean Spaces connectivity"
    echo -e "      Requires: SPACES_KEY, SPACES_SECRET, SPACES_ENDPOINT"
    echo ""
    echo -e "  ${CYAN}test-connectivity.sh <url|host> [port]${NC}"
    echo -e "      Test network connectivity to URLs or hosts"
    echo ""
}

print_quick_examples() {
    echo -e "${BOLD}QUICK EXAMPLES${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"
    echo -e "  # Run full diagnostics"
    echo -e "  ${YELLOW}diagnose.sh${NC}"
    echo ""
    echo -e "  # Test database connections"
    echo -e "  ${YELLOW}test-db.sh postgres${NC}    # Uses \$DATABASE_URL"
    echo -e "  ${YELLOW}test-db.sh redis${NC}       # Uses \$REDIS_URL"
    echo -e "  ${YELLOW}test-db.sh mongodb${NC}     # Uses \$MONGODB_URI"
    echo -e "  ${YELLOW}test-db.sh kafka${NC}       # Uses \$KAFKA_BROKERS"
    echo -e "  ${YELLOW}test-db.sh opensearch${NC}  # Uses \$OPENSEARCH_URL"
    echo ""
    echo -e "  # Test Spaces (S3-compatible storage)"
    echo -e "  ${YELLOW}test-spaces.sh${NC}         # Uses \$SPACES_KEY, \$SPACES_SECRET"
    echo ""
    echo -e "  # Test network connectivity"
    echo -e "  ${YELLOW}test-connectivity.sh https://api.example.com${NC}"
    echo -e "  ${YELLOW}test-connectivity.sh db.example.com 5432${NC}"
    echo ""
    echo -e "  # Direct database client commands"
    echo -e "  ${YELLOW}psql \$DATABASE_URL${NC}"
    echo -e "  ${YELLOW}redis-cli -u \$REDIS_URL ping${NC}"
    echo -e "  ${YELLOW}mongosh \$MONGODB_URI${NC}"
    echo ""
    echo -e "  # DigitalOcean CLI"
    echo -e "  ${YELLOW}doctl auth init${NC}        # Authenticate with DO API"
    echo -e "  ${YELLOW}doctl apps list${NC}        # List your apps"
    echo ""
}

print_env_vars() {
    echo -e "${BOLD}ENVIRONMENT VARIABLES FOR DATABASE TESTING${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"
    echo -e "  DATABASE_URL      PostgreSQL connection string"
    echo -e "  MYSQL_URL         MySQL connection string"
    echo -e "  REDIS_URL         Redis/Valkey connection string"
    echo -e "  MONGODB_URI       MongoDB connection string"
    echo -e "  KAFKA_BROKERS     Kafka broker addresses (comma-separated)"
    echo -e "  OPENSEARCH_URL    OpenSearch endpoint URL"
    echo ""
}

print_detected_env_vars() {
    echo -e "${BOLD}DETECTED DATABASE CONNECTIONS${NC}"
    echo -e "─────────────────────────────────────────────────────────────────────────────"

    local found=false

    if [ -n "${DATABASE_URL:-}" ]; then
        echo -e "  ${GREEN}✓${NC} DATABASE_URL is set"
        found=true
    fi
    if [ -n "${MYSQL_URL:-}" ]; then
        echo -e "  ${GREEN}✓${NC} MYSQL_URL is set"
        found=true
    fi
    if [ -n "${REDIS_URL:-}" ]; then
        echo -e "  ${GREEN}✓${NC} REDIS_URL is set"
        found=true
    fi
    if [ -n "${MONGODB_URI:-}" ]; then
        echo -e "  ${GREEN}✓${NC} MONGODB_URI is set"
        found=true
    fi
    if [ -n "${KAFKA_BROKERS:-}" ]; then
        echo -e "  ${GREEN}✓${NC} KAFKA_BROKERS is set"
        found=true
    fi
    if [ -n "${OPENSEARCH_URL:-}" ]; then
        echo -e "  ${GREEN}✓${NC} OPENSEARCH_URL is set"
        found=true
    fi
    if [ -n "${SPACES_KEY:-}" ] && [ -n "${SPACES_SECRET:-}" ]; then
        echo -e "  ${GREEN}✓${NC} SPACES credentials are set"
        found=true
    fi

    if [ "$found" = false ]; then
        echo -e "  ${YELLOW}No database/storage connection variables detected${NC}"
        echo -e "  Add them in your App Platform configuration to test connectivity"
    fi
    echo ""
}

print_footer() {
    echo -e "${CYAN}================================================================================${NC}"
    echo -e "  Health server running on port ${PORT}"
    echo -e "  Access shell: ${YELLOW}doctl apps console <app-id> <component-name>${NC}"
    echo -e "${CYAN}================================================================================${NC}"
    echo ""
}

# Main startup sequence
print_banner
print_runtime_info
print_database_clients
print_tools
print_detected_env_vars
print_diagnostic_scripts
print_quick_examples
print_footer

# Start the health server
exec /usr/local/bin/health-server
