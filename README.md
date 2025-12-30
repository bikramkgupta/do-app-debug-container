# DigitalOcean App Platform Debug Container

Pre-built debug containers for diagnosing connectivity, database, and infrastructure issues in DigitalOcean App Platform. **Deploys in 30-45 seconds** using pre-built images from GitHub Container Registry.

## Why Use This?

When troubleshooting App Platform issues, you need to answer questions like:
- Can my app reach the database?
- Is DNS resolving correctly?
- Are external APIs accessible?
- What environment variables are available?

These debug containers come **fully loaded** with all diagnostic tools, eliminating the slow "guess → push → wait 5-7 min → check" debugging cycle.

## Available Images

| Image | Runtime | Use Case |
|-------|---------|----------|
| `ghcr.io/bikramkgupta/debug-python` | Python 3.x | Python/Django/Flask apps |
| `ghcr.io/bikramkgupta/debug-node` | Node.js 20.x | Node/Express/Next.js apps |

Both images include identical CLI tools and database clients. Choose based on your app's runtime for native library support.

## Quick Start

### Deploy Python Debug Container (~30 seconds)

```bash
doctl apps create --spec app-specs/debug-python.yaml
```

### Deploy Node.js Debug Container (~30 seconds)

```bash
doctl apps create --spec app-specs/debug-node.yaml
```

### Add to Existing App (as a Worker)

Add the debug container as a worker component to test connectivity within your app's network:

```yaml
workers:
  - name: debug
    image:
      registry_type: GHCR
      registry: bikramkgupta
      repository: debug-python  # or debug-node
      tag: latest
    instance_size_slug: basic-xxs
    instance_count: 1
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${db.DATABASE_URL}
```

See `app-specs/debug-worker-python.yaml` or `app-specs/debug-worker-node.yaml` for complete examples.

## Included Tools

### Database Clients (CLI)

| Database | CLI Tool | Environment Variable |
|----------|----------|---------------------|
| PostgreSQL | `psql` | `DATABASE_URL` |
| MySQL | `mysql` | `MYSQL_URL` |
| Redis/Valkey | `redis-cli` | `REDIS_URL` |
| MongoDB | `mongosh` | `MONGODB_URI` |
| Kafka | `kcat` | `KAFKA_BROKERS` |
| OpenSearch | `curl + jq` | `OPENSEARCH_URL` |

### Database Libraries

**Python image:**
- `psycopg2-binary` (PostgreSQL)
- `pymysql` (MySQL)
- `redis` (Redis/Valkey)
- `pymongo` (MongoDB)
- `confluent-kafka`, `kafka-python-ng` (Kafka)
- `opensearch-py` (OpenSearch)
- `boto3` (Spaces/S3)

**Node.js image:**
- `pg` (PostgreSQL)
- `mysql2` (MySQL)
- `ioredis` (Redis/Valkey)
- `mongodb` (MongoDB)
- `kafkajs` (Kafka)
- `@opensearch-project/opensearch` (OpenSearch)
- `@aws-sdk/client-s3` (Spaces/S3)

### Network Diagnostics

- `curl`, `wget` - HTTP clients
- `dig`, `nslookup` - DNS lookup
- `ping`, `traceroute` - Network path testing
- `netcat (nc)` - TCP/UDP connectivity
- `ss`, `netstat` - Socket statistics
- `nmap` - Network exploration
- `tcpdump` - Packet capture

### DigitalOcean Tools

- `doctl` - DigitalOcean CLI (latest version, auto-updated)

### Spaces (S3-Compatible Storage)

Both images include libraries for DigitalOcean Spaces:
- Python: `boto3`
- Node.js: `@aws-sdk/client-s3`

### System Tools

- `htop`, `ps`, `top` - Process monitoring
- `free`, `df` - Memory and disk usage
- `lsof`, `strace` - Debugging
- `jq` - JSON processing
- `vim`, `less`, `tmux` - Editors and utilities

## Usage

### Startup Banner

When the container starts, it displays available commands and detected database connections in the runtime logs:

```
================================================================================
  DigitalOcean App Platform Debug Container
================================================================================

  Runtime: Python
  Health Server: http://0.0.0.0:8080

  DIAGNOSTIC SCRIPTS:
  diagnose.sh              Full system diagnostic report
  test-db.sh <type>        Database connectivity test
  test-connectivity.sh     Network connectivity test

  DETECTED DATABASE CONNECTIONS:
  ✓ DATABASE_URL is set
  ✓ REDIS_URL is set
================================================================================
```

### Diagnostic Scripts

Access the container shell and run:

```bash
# Full system diagnostic (memory, disk, network, env vars, database checks)
diagnose.sh

# Test specific database connectivity
test-db.sh postgres      # Uses $DATABASE_URL
test-db.sh mysql         # Uses $MYSQL_URL
test-db.sh redis         # Uses $REDIS_URL (works with Valkey too)
test-db.sh mongodb       # Uses $MONGODB_URI
test-db.sh kafka         # Uses $KAFKA_BROKERS
test-db.sh opensearch    # Uses $OPENSEARCH_URL

# Test DigitalOcean Spaces connectivity
test-spaces.sh           # Uses $SPACES_KEY, $SPACES_SECRET, $SPACES_ENDPOINT

# Test network connectivity
test-connectivity.sh https://api.example.com
test-connectivity.sh db.example.com 5432
```

### Shell Access

```bash
# List your apps
doctl apps list

# Access container shell
doctl apps console <app-id> debug
```

### HTTP Endpoints

When deployed as a service, the container exposes:

| Endpoint | Description |
|----------|-------------|
| `/` | Container info and available scripts |
| `/health` | Health check (`{"status": "healthy"}`) |

## Environment Variables

| Variable | Description | Used By |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `test-db.sh postgres` |
| `MYSQL_URL` | MySQL connection string | `test-db.sh mysql` |
| `REDIS_URL` | Redis/Valkey connection string | `test-db.sh redis` |
| `MONGODB_URI` | MongoDB connection string | `test-db.sh mongodb` |
| `KAFKA_BROKERS` | Kafka broker addresses (comma-separated) | `test-db.sh kafka` |
| `OPENSEARCH_URL` | OpenSearch endpoint URL | `test-db.sh opensearch` |
| `SPACES_KEY` | Spaces access key | `test-spaces.sh` |
| `SPACES_SECRET` | Spaces secret key | `test-spaces.sh` |
| `SPACES_ENDPOINT` | Spaces endpoint (e.g., `nyc3.digitaloceanspaces.com`) | `test-spaces.sh` |
| `SPACES_BUCKET` | Bucket name (optional) | `test-spaces.sh` |

## Common Issues & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `bind: address already in use` | Port conflict | Check `PORT` env var |
| `ECONNREFUSED` | Database not attached | Verify database binding in app spec |
| `Exit code 137` | Out of memory | Increase instance size |
| `Health check failed` | App not responding | Debug with this container |
| `DNS resolution fails` | DNS propagation delay | Wait 1-2 minutes |

## Building Images Locally

```bash
# Build Python variant
docker build --target debug-python -t debug-python .

# Build Node.js variant
docker build --target debug-node -t debug-node .
```

## GitHub Actions

Images are automatically built and pushed to GHCR when you:
1. Push a version tag (e.g., `v1.0.0`)
2. Manually trigger the workflow

See `.github/workflows/build-and-push.yml`.

## Security Notes

- Deploy as a **worker** (not service) in production to avoid public exposure
- Sensitive environment variables are redacted in diagnostic output
- Remove the debug container after troubleshooting is complete
- The container sets `PS1='\u@\h:\w\$ '` for SDK compatibility

## Repository Structure

```
.
├── Dockerfile                    # Multi-stage build (Python & Node.js)
├── health-server/                # Go health server source
│   ├── main.go
│   └── go.mod
├── scripts/
│   ├── startup.sh                # Container startup with banner
│   ├── diagnose.sh               # Full diagnostic report
│   ├── test-db.sh                # Database connectivity tests
│   └── test-connectivity.sh      # Network connectivity tests
├── app-specs/
│   ├── debug-python.yaml         # Standalone Python service
│   ├── debug-node.yaml           # Standalone Node.js service
│   ├── debug-worker-python.yaml  # Python worker template
│   └── debug-worker-node.yaml    # Node.js worker template
└── .github/workflows/
    └── build-and-push.yml        # CI/CD for GHCR
```

## License

MIT
