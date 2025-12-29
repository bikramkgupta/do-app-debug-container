#!/bin/bash
# Test database connectivity
# Usage: test-db.sh [postgres|mysql|redis]

DB_TYPE="${1:-postgres}"

case "$DB_TYPE" in
    postgres|pg)
        if [ -z "$DATABASE_URL" ] && [ -z "$POSTGRES_URL" ]; then
            echo "Error: DATABASE_URL or POSTGRES_URL not set"
            exit 1
        fi
        URL="${DATABASE_URL:-$POSTGRES_URL}"
        echo "Testing PostgreSQL connectivity..."
        python3 -c "
import psycopg2
import os
try:
    url = '$URL'
    conn = psycopg2.connect(url, connect_timeout=10)
    cursor = conn.cursor()
    cursor.execute('SELECT version();')
    version = cursor.fetchone()[0]
    print(f'SUCCESS: Connected to PostgreSQL')
    print(f'Version: {version}')
    cursor.execute('SELECT current_database(), current_user;')
    db, user = cursor.fetchone()
    print(f'Database: {db}')
    print(f'User: {user}')
    cursor.close()
    conn.close()
except Exception as e:
    print(f'FAILED: {e}')
    exit(1)
"
        ;;

    mysql)
        if [ -z "$MYSQL_URL" ] && [ -z "$DATABASE_URL" ]; then
            echo "Error: MYSQL_URL or DATABASE_URL not set"
            exit 1
        fi
        URL="${MYSQL_URL:-$DATABASE_URL}"
        echo "Testing MySQL connectivity..."
        python3 -c "
import pymysql
from urllib.parse import urlparse
try:
    url = '$URL'
    parsed = urlparse(url)
    conn = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip('/'),
        connect_timeout=10
    )
    cursor = conn.cursor()
    cursor.execute('SELECT VERSION();')
    version = cursor.fetchone()[0]
    print(f'SUCCESS: Connected to MySQL')
    print(f'Version: {version}')
    cursor.execute('SELECT DATABASE(), USER();')
    db, user = cursor.fetchone()
    print(f'Database: {db}')
    print(f'User: {user}')
    cursor.close()
    conn.close()
except Exception as e:
    print(f'FAILED: {e}')
    exit(1)
"
        ;;

    redis)
        if [ -z "$REDIS_URL" ]; then
            echo "Error: REDIS_URL not set"
            exit 1
        fi
        echo "Testing Redis connectivity..."
        python3 -c "
import redis
import os
try:
    r = redis.from_url('$REDIS_URL', socket_connect_timeout=10)
    info = r.info('server')
    print('SUCCESS: Connected to Redis')
    print(f\"Version: {info.get('redis_version', 'unknown')}\")
    print(f\"Mode: {info.get('redis_mode', 'unknown')}\")
except Exception as e:
    print(f'FAILED: {e}')
    exit(1)
"
        ;;

    *)
        echo "Usage: test-db.sh [postgres|mysql|redis]"
        exit 1
        ;;
esac
