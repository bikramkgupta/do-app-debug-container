#!/bin/bash
# Test database connectivity
# Usage: test-db.sh [postgres|mysql|redis|mongodb|kafka|opensearch]
#
# Supports both Python and Node.js runtimes - auto-detects available runtime

set -euo pipefail

DB_TYPE="${1:-}"
RUNTIME="${DEBUG_RUNTIME:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Auto-detect runtime if not set
if [ -z "$RUNTIME" ]; then
    if command -v python3 &> /dev/null; then
        RUNTIME="python"
    elif command -v node &> /dev/null; then
        RUNTIME="node"
    else
        echo -e "${RED}Error: No supported runtime found (Python or Node.js)${NC}"
        exit 1
    fi
fi

show_usage() {
    echo "Usage: test-db.sh <database-type>"
    echo ""
    echo "Database types:"
    echo "  postgres, pg     Test PostgreSQL (uses \$DATABASE_URL or \$POSTGRES_URL)"
    echo "  mysql            Test MySQL (uses \$MYSQL_URL or \$DATABASE_URL)"
    echo "  redis            Test Redis/Valkey (uses \$REDIS_URL)"
    echo "  mongodb, mongo   Test MongoDB (uses \$MONGODB_URI)"
    echo "  kafka            Test Kafka (uses \$KAFKA_BROKERS)"
    echo "  opensearch, os   Test OpenSearch (uses \$OPENSEARCH_URL)"
    echo ""
    echo "Detected runtime: $RUNTIME"
    exit 1
}

if [ -z "$DB_TYPE" ]; then
    show_usage
fi

test_postgres_python() {
    python3 << 'PYEOF'
import psycopg2
import os
import sys

url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
if not url:
    print('\033[0;31mError: DATABASE_URL or POSTGRES_URL not set\033[0m')
    sys.exit(1)

print('Testing PostgreSQL connectivity...')
try:
    conn = psycopg2.connect(url, connect_timeout=10)
    cursor = conn.cursor()
    cursor.execute('SELECT version();')
    version = cursor.fetchone()[0]
    print(f'\033[0;32mSUCCESS\033[0m: Connected to PostgreSQL')
    print(f'Version: {version.split(",")[0]}')
    cursor.execute('SELECT current_database(), current_user;')
    db, user = cursor.fetchone()
    print(f'Database: {db}')
    print(f'User: {user}')
    cursor.close()
    conn.close()
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_postgres_node() {
    node << 'NODEEOF'
const { Client } = require('pg');
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
    console.log('\x1b[31mError: DATABASE_URL or POSTGRES_URL not set\x1b[0m');
    process.exit(1);
}
console.log('Testing PostgreSQL connectivity...');
const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
client.connect()
    .then(() => client.query('SELECT version(), current_database(), current_user'))
    .then(res => {
        console.log('\x1b[32mSUCCESS\x1b[0m: Connected to PostgreSQL');
        console.log('Version:', res.rows[0].version.split(',')[0]);
        console.log('Database:', res.rows[0].current_database);
        console.log('User:', res.rows[0].current_user);
        client.end();
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

test_mysql_python() {
    python3 << 'PYEOF'
import pymysql
from urllib.parse import urlparse
import os
import sys

url = os.environ.get('MYSQL_URL') or os.environ.get('DATABASE_URL')
if not url:
    print('\033[0;31mError: MYSQL_URL or DATABASE_URL not set\033[0m')
    sys.exit(1)

print('Testing MySQL connectivity...')
try:
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
    print(f'\033[0;32mSUCCESS\033[0m: Connected to MySQL')
    print(f'Version: {version}')
    cursor.execute('SELECT DATABASE(), USER();')
    db, user = cursor.fetchone()
    print(f'Database: {db}')
    print(f'User: {user}')
    cursor.close()
    conn.close()
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_mysql_node() {
    node << 'NODEEOF'
const mysql = require('mysql2/promise');
const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!url) {
    console.log('\x1b[31mError: MYSQL_URL or DATABASE_URL not set\x1b[0m');
    process.exit(1);
}
console.log('Testing MySQL connectivity...');
mysql.createConnection(url)
    .then(conn => {
        return conn.query('SELECT VERSION() as version, DATABASE() as db, USER() as user')
            .then(([rows]) => {
                console.log('\x1b[32mSUCCESS\x1b[0m: Connected to MySQL');
                console.log('Version:', rows[0].version);
                console.log('Database:', rows[0].db);
                console.log('User:', rows[0].user);
                conn.end();
            });
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

test_redis_python() {
    python3 << 'PYEOF'
import redis
import os
import sys

url = os.environ.get('REDIS_URL')
if not url:
    print('\033[0;31mError: REDIS_URL not set\033[0m')
    sys.exit(1)

print('Testing Redis/Valkey connectivity...')
try:
    r = redis.from_url(url, socket_connect_timeout=10)
    info = r.info('server')
    print(f'\033[0;32mSUCCESS\033[0m: Connected to Redis/Valkey')
    print(f"Version: {info.get('redis_version', 'unknown')}")
    print(f"Mode: {info.get('redis_mode', 'standalone')}")
    # Test basic operations
    r.ping()
    print('Ping: PONG')
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_redis_node() {
    node << 'NODEEOF'
const Redis = require('ioredis');
const url = process.env.REDIS_URL;
if (!url) {
    console.log('\x1b[31mError: REDIS_URL not set\x1b[0m');
    process.exit(1);
}
console.log('Testing Redis/Valkey connectivity...');
const redis = new Redis(url, { connectTimeout: 10000, lazyConnect: true });
redis.connect()
    .then(() => redis.info('server'))
    .then(info => {
        console.log('\x1b[32mSUCCESS\x1b[0m: Connected to Redis/Valkey');
        const version = info.match(/redis_version:(.+)/);
        const mode = info.match(/redis_mode:(.+)/);
        if (version) console.log('Version:', version[1].trim());
        if (mode) console.log('Mode:', mode[1].trim());
        return redis.ping();
    })
    .then(() => {
        console.log('Ping: PONG');
        redis.disconnect();
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

test_mongodb_python() {
    python3 << 'PYEOF'
from pymongo import MongoClient
import os
import sys

uri = os.environ.get('MONGODB_URI')
if not uri:
    print('\033[0;31mError: MONGODB_URI not set\033[0m')
    sys.exit(1)

print('Testing MongoDB connectivity...')
try:
    client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    # Force connection
    info = client.server_info()
    print(f'\033[0;32mSUCCESS\033[0m: Connected to MongoDB')
    print(f"Version: {info.get('version', 'unknown')}")
    # List databases
    dbs = client.list_database_names()
    print(f"Databases: {', '.join(dbs[:5])}" + ('...' if len(dbs) > 5 else ''))
    client.close()
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_mongodb_node() {
    node << 'NODEEOF'
const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI;
if (!uri) {
    console.log('\x1b[31mError: MONGODB_URI not set\x1b[0m');
    process.exit(1);
}
console.log('Testing MongoDB connectivity...');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
client.connect()
    .then(() => client.db().admin().serverInfo())
    .then(info => {
        console.log('\x1b[32mSUCCESS\x1b[0m: Connected to MongoDB');
        console.log('Version:', info.version);
        return client.db().admin().listDatabases();
    })
    .then(result => {
        const dbs = result.databases.map(d => d.name).slice(0, 5);
        console.log('Databases:', dbs.join(', ') + (result.databases.length > 5 ? '...' : ''));
        client.close();
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

test_kafka_python() {
    python3 << 'PYEOF'
from kafka import KafkaAdminClient
from kafka.errors import KafkaError
import os
import sys

brokers = os.environ.get('KAFKA_BROKERS')
if not brokers:
    print('\033[0;31mError: KAFKA_BROKERS not set\033[0m')
    sys.exit(1)

print('Testing Kafka connectivity...')
try:
    broker_list = brokers.split(',')
    admin = KafkaAdminClient(
        bootstrap_servers=broker_list,
        request_timeout_ms=10000,
        api_version_auto_timeout_ms=10000
    )
    # Get cluster metadata
    topics = admin.list_topics()
    print(f'\033[0;32mSUCCESS\033[0m: Connected to Kafka')
    print(f'Brokers: {", ".join(broker_list)}')
    print(f'Topics: {len(topics)} available')
    if topics:
        print(f'Sample topics: {", ".join(list(topics)[:5])}' + ('...' if len(topics) > 5 else ''))
    admin.close()
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_kafka_node() {
    node << 'NODEEOF'
const { Kafka } = require('kafkajs');
const brokers = process.env.KAFKA_BROKERS;
if (!brokers) {
    console.log('\x1b[31mError: KAFKA_BROKERS not set\x1b[0m');
    process.exit(1);
}
console.log('Testing Kafka connectivity...');
const brokerList = brokers.split(',');
const kafka = new Kafka({
    clientId: 'debug-container',
    brokers: brokerList,
    connectionTimeout: 10000
});
const admin = kafka.admin();
admin.connect()
    .then(() => admin.listTopics())
    .then(topics => {
        console.log('\x1b[32mSUCCESS\x1b[0m: Connected to Kafka');
        console.log('Brokers:', brokerList.join(', '));
        console.log('Topics:', topics.length, 'available');
        if (topics.length > 0) {
            console.log('Sample topics:', topics.slice(0, 5).join(', ') + (topics.length > 5 ? '...' : ''));
        }
        admin.disconnect();
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

test_opensearch_python() {
    python3 << 'PYEOF'
from opensearchpy import OpenSearch
from urllib.parse import urlparse
import os
import sys

url = os.environ.get('OPENSEARCH_URL')
if not url:
    print('\033[0;31mError: OPENSEARCH_URL not set\033[0m')
    sys.exit(1)

print('Testing OpenSearch connectivity...')
try:
    parsed = urlparse(url)
    auth = (parsed.username, parsed.password) if parsed.username else None
    host = parsed.hostname
    port = parsed.port or 9200
    use_ssl = parsed.scheme == 'https'

    client = OpenSearch(
        hosts=[{'host': host, 'port': port}],
        http_auth=auth,
        use_ssl=use_ssl,
        verify_certs=True,
        timeout=10
    )
    info = client.info()
    print(f'\033[0;32mSUCCESS\033[0m: Connected to OpenSearch')
    print(f"Version: {info['version']['number']}")
    print(f"Cluster: {info['cluster_name']}")
    # Get indices count
    indices = client.cat.indices(format='json')
    print(f'Indices: {len(indices)} available')
except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_opensearch_node() {
    node << 'NODEEOF'
const { Client } = require('@opensearch-project/opensearch');
const url = process.env.OPENSEARCH_URL;
if (!url) {
    console.log('\x1b[31mError: OPENSEARCH_URL not set\x1b[0m');
    process.exit(1);
}
console.log('Testing OpenSearch connectivity...');
const client = new Client({ node: url, requestTimeout: 10000 });
client.info()
    .then(({ body }) => {
        console.log('\x1b[32mSUCCESS\x1b[0m: Connected to OpenSearch');
        console.log('Version:', body.version.number);
        console.log('Cluster:', body.cluster_name);
        return client.cat.indices({ format: 'json' });
    })
    .then(({ body }) => {
        console.log('Indices:', body.length, 'available');
        client.close();
    })
    .catch(err => {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    });
NODEEOF
}

# Also provide CLI-based tests as fallback
test_with_cli() {
    local db_type="$1"
    case "$db_type" in
        postgres)
            if [ -n "${DATABASE_URL:-}" ]; then
                echo "Testing with psql..."
                psql "$DATABASE_URL" -c "SELECT version();" 2>&1 || echo "psql test failed"
            fi
            ;;
        redis)
            if [ -n "${REDIS_URL:-}" ]; then
                echo "Testing with redis-cli..."
                redis-cli -u "$REDIS_URL" ping 2>&1 || echo "redis-cli test failed"
            fi
            ;;
        mongodb)
            if [ -n "${MONGODB_URI:-}" ]; then
                echo "Testing with mongosh..."
                mongosh "$MONGODB_URI" --eval "db.runCommand({ping:1})" 2>&1 || echo "mongosh test failed"
            fi
            ;;
        kafka)
            if [ -n "${KAFKA_BROKERS:-}" ]; then
                echo "Testing with kcat..."
                kcat -b "$KAFKA_BROKERS" -L -t __consumer_offsets 2>&1 | head -10 || echo "kcat test failed"
            fi
            ;;
    esac
}

# Main
case "$DB_TYPE" in
    postgres|pg)
        if [ "$RUNTIME" = "python" ]; then
            test_postgres_python
        else
            test_postgres_node
        fi
        ;;
    mysql)
        if [ "$RUNTIME" = "python" ]; then
            test_mysql_python
        else
            test_mysql_node
        fi
        ;;
    redis|valkey)
        if [ "$RUNTIME" = "python" ]; then
            test_redis_python
        else
            test_redis_node
        fi
        ;;
    mongodb|mongo)
        if [ "$RUNTIME" = "python" ]; then
            test_mongodb_python
        else
            test_mongodb_node
        fi
        ;;
    kafka)
        if [ "$RUNTIME" = "python" ]; then
            test_kafka_python
        else
            test_kafka_node
        fi
        ;;
    opensearch|os)
        if [ "$RUNTIME" = "python" ]; then
            test_opensearch_python
        else
            test_opensearch_node
        fi
        ;;
    *)
        show_usage
        ;;
esac
