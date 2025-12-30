#!/bin/bash
# Full system diagnostic report for App Platform debugging
# Works with both Python and Node.js runtimes

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

RUNTIME="${DEBUG_RUNTIME:-unknown}"

echo ""
echo -e "${CYAN}==========================================${NC}"
echo -e "${BOLD}  App Platform Debug Container Diagnostic${NC}"
echo -e "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo -e "${CYAN}==========================================${NC}"

echo ""
echo -e "${BOLD}=== RUNTIME INFO ===${NC}"
echo "Container Type: ${DEBUG_CONTAINER_TYPE:-unknown}"
if [ "$RUNTIME" = "python" ]; then
    echo "Runtime: Python"
    python3 --version 2>/dev/null || echo "Python version unavailable"
elif [ "$RUNTIME" = "node" ]; then
    echo "Runtime: Node.js"
    node --version 2>/dev/null || echo "Node version unavailable"
else
    echo "Runtime: Unknown"
fi
echo ""

echo -e "${BOLD}=== SYSTEM INFO ===${NC}"
echo "Hostname: $(hostname)"
echo "Kernel: $(uname -r)"
echo ""

echo -e "${BOLD}=== MEMORY ===${NC}"
free -m
echo ""

echo -e "${BOLD}=== DISK USAGE ===${NC}"
df -h
echo ""

echo -e "${BOLD}=== RUNNING PROCESSES ===${NC}"
ps aux --sort=-%mem | head -15
echo ""

echo -e "${BOLD}=== LISTENING PORTS ===${NC}"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Unable to list ports"
echo ""

echo -e "${BOLD}=== ENVIRONMENT VARIABLES ===${NC}"
echo "(Sensitive values redacted)"
env | sort | while read line; do
    key="${line%%=*}"
    if echo "$key" | grep -qiE '(key|secret|password|token|credential|private)'; then
        echo "$key=[REDACTED]"
    else
        echo "$line"
    fi
done
echo ""

echo -e "${BOLD}=== DNS RESOLUTION ===${NC}"
echo "Resolv.conf:"
cat /etc/resolv.conf 2>/dev/null || echo "Unable to read resolv.conf"
echo ""
echo "Testing DNS for google.com:"
dig +short google.com 2>/dev/null || nslookup google.com 2>/dev/null || echo "DNS test failed"
echo ""

echo -e "${BOLD}=== EXTERNAL CONNECTIVITY ===${NC}"
echo "Testing HTTPS to google.com..."
curl -s -o /dev/null -w "HTTP Code: %{http_code}, Time: %{time_total}s\n" -m 10 https://www.google.com || echo "Connectivity test failed"
echo ""

echo -e "${BOLD}=== DATABASE CONNECTIVITY ===${NC}"

# PostgreSQL
if [ -n "${DATABASE_URL:-}" ] || [ -n "${POSTGRES_URL:-}" ]; then
    echo ""
    echo -e "${CYAN}PostgreSQL:${NC}"
    URL="${DATABASE_URL:-$POSTGRES_URL}"
    if command -v pg_isready &> /dev/null; then
        DB_HOST=$(echo "$URL" | sed -n 's/.*@\([^:\/]*\).*/\1/p')
        DB_PORT=$(echo "$URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        if pg_isready -h "$DB_HOST" -p "${DB_PORT:-5432}" -t 5 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} PostgreSQL is reachable"
        else
            echo -e "  ${RED}✗${NC} PostgreSQL is not reachable"
        fi
    else
        echo "  pg_isready not available, run: test-db.sh postgres"
    fi
else
    echo -e "PostgreSQL: ${YELLOW}DATABASE_URL not set${NC}"
fi

# MySQL
if [ -n "${MYSQL_URL:-}" ]; then
    echo ""
    echo -e "${CYAN}MySQL:${NC}"
    echo "  MYSQL_URL is set, run: test-db.sh mysql"
else
    echo -e "MySQL: ${YELLOW}MYSQL_URL not set${NC}"
fi

# Redis/Valkey
if [ -n "${REDIS_URL:-}" ]; then
    echo ""
    echo -e "${CYAN}Redis/Valkey:${NC}"
    if command -v redis-cli &> /dev/null; then
        if redis-cli -u "$REDIS_URL" ping 2>/dev/null | grep -q PONG; then
            echo -e "  ${GREEN}✓${NC} Redis is reachable (PONG)"
        else
            echo -e "  ${RED}✗${NC} Redis ping failed"
        fi
    else
        echo "  redis-cli not available, run: test-db.sh redis"
    fi
else
    echo -e "Redis/Valkey: ${YELLOW}REDIS_URL not set${NC}"
fi

# MongoDB
if [ -n "${MONGODB_URI:-}" ]; then
    echo ""
    echo -e "${CYAN}MongoDB:${NC}"
    if command -v mongosh &> /dev/null; then
        if mongosh "$MONGODB_URI" --eval "db.runCommand({ping:1})" --quiet 2>/dev/null | grep -q "ok"; then
            echo -e "  ${GREEN}✓${NC} MongoDB is reachable"
        else
            echo -e "  ${RED}✗${NC} MongoDB ping failed"
        fi
    else
        echo "  mongosh not available, run: test-db.sh mongodb"
    fi
else
    echo -e "MongoDB: ${YELLOW}MONGODB_URI not set${NC}"
fi

# Kafka
if [ -n "${KAFKA_BROKERS:-}" ]; then
    echo ""
    echo -e "${CYAN}Kafka:${NC}"
    echo "  KAFKA_BROKERS is set: ${KAFKA_BROKERS}"
    echo "  Run: test-db.sh kafka"
else
    echo -e "Kafka: ${YELLOW}KAFKA_BROKERS not set${NC}"
fi

# OpenSearch
if [ -n "${OPENSEARCH_URL:-}" ]; then
    echo ""
    echo -e "${CYAN}OpenSearch:${NC}"
    if curl -s -o /dev/null -w "%{http_code}" -m 5 "$OPENSEARCH_URL" 2>/dev/null | grep -qE "^(200|401)"; then
        echo -e "  ${GREEN}✓${NC} OpenSearch endpoint is reachable"
    else
        echo -e "  ${RED}✗${NC} OpenSearch endpoint not reachable"
    fi
else
    echo -e "OpenSearch: ${YELLOW}OPENSEARCH_URL not set${NC}"
fi

echo ""
echo -e "${CYAN}==========================================${NC}"
echo -e "  Diagnostic complete"
echo ""
echo -e "  ${BOLD}For detailed database tests, run:${NC}"
echo "  test-db.sh postgres"
echo "  test-db.sh mysql"
echo "  test-db.sh redis"
echo "  test-db.sh mongodb"
echo "  test-db.sh kafka"
echo "  test-db.sh opensearch"
echo -e "${CYAN}==========================================${NC}"
