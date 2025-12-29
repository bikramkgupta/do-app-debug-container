#!/bin/bash
# Full system diagnostic report for App Platform debugging

echo "=========================================="
echo "  App Platform Debug Container Diagnostic"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="

echo ""
echo "=== SYSTEM INFO ==="
echo "Hostname: $(hostname)"
echo "Kernel: $(uname -r)"
echo ""

echo "=== MEMORY ==="
free -m
echo ""

echo "=== DISK USAGE ==="
df -h
echo ""

echo "=== RUNNING PROCESSES ==="
ps aux --sort=-%mem | head -15
echo ""

echo "=== LISTENING PORTS ==="
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null
echo ""

echo "=== ENVIRONMENT VARIABLES ==="
echo "(Sensitive values redacted)"
env | sort | while read line; do
    key="${line%%=*}"
    if echo "$key" | grep -qiE '(key|secret|password|token|credential)'; then
        echo "$key=[REDACTED]"
    else
        echo "$line"
    fi
done
echo ""

echo "=== DNS RESOLUTION ==="
echo "Resolv.conf:"
cat /etc/resolv.conf
echo ""
echo "Testing DNS for google.com:"
dig +short google.com 2>/dev/null || nslookup google.com 2>/dev/null
echo ""

echo "=== EXTERNAL CONNECTIVITY ==="
echo "Testing HTTPS to google.com..."
curl -s -o /dev/null -w "HTTP Code: %{http_code}, Time: %{time_total}s\n" -m 10 https://www.google.com
echo ""

echo "=== DATABASE CONNECTIVITY ==="
if [ -n "$DATABASE_URL" ]; then
    echo "DATABASE_URL is set, testing PostgreSQL..."
    if command -v pg_isready &> /dev/null; then
        # Extract host and port from DATABASE_URL
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:\/]*\).*/\1/p')
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        pg_isready -h "$DB_HOST" -p "${DB_PORT:-5432}" -t 5
    else
        echo "pg_isready not available, trying Python..."
        python3 -c "
import psycopg2
import os
try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=5)
    print('PostgreSQL connection: SUCCESS')
    conn.close()
except Exception as e:
    print(f'PostgreSQL connection: FAILED - {e}')
"
    fi
else
    echo "DATABASE_URL not set"
fi

if [ -n "$REDIS_URL" ]; then
    echo ""
    echo "REDIS_URL is set, testing Redis..."
    python3 -c "
import redis
import os
try:
    r = redis.from_url(os.environ['REDIS_URL'], socket_connect_timeout=5)
    r.ping()
    print('Redis connection: SUCCESS')
except Exception as e:
    print(f'Redis connection: FAILED - {e}')
"
else
    echo "REDIS_URL not set"
fi
echo ""

echo "=========================================="
echo "  Diagnostic complete"
echo "=========================================="
