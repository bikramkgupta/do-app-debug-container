# DigitalOcean App Platform Debug Container

A comprehensive debugging container for diagnosing connectivity, database, and infrastructure issues in DigitalOcean App Platform deployments.

## Why Use This?

When troubleshooting App Platform issues, you often need to answer questions like:
- Can my app reach the database?
- Is DNS resolving correctly?
- Are external APIs accessible from within App Platform?
- What environment variables are available at runtime?

This debug container comes pre-loaded with all the tools you need to answer these questions, eliminating the slow "guess → push → wait 5-7 min → check → repeat" debugging cycle.

## Quick Start

### Option 1: Deploy Standalone

```bash
# Clone and deploy
git clone https://github.com/bikramkgupta/do-app-debug-container.git
cd do-app-debug-container
doctl apps create --spec app.yaml
```

### Option 2: Add to Existing App

Add the debug container as a worker to your existing app. See `examples/add-to-existing-app.yaml`.

### Option 3: Alpine Quick Deploy (~45 seconds)

For the fastest possible deployment to test infrastructure:

```bash
doctl apps create --spec examples/alpine-quick-deploy.yaml
```

## Included Tools

### Network Diagnostics
- `curl`, `wget` - HTTP client tools
- `dig`, `nslookup` - DNS lookup
- `ping`, `traceroute` - Network path testing
- `netcat (nc)` - TCP/UDP connectivity testing
- `ss`, `netstat` - Socket statistics
- `nmap` - Network exploration
- `tcpdump` - Packet capture

### Database Clients
- `psql` - PostgreSQL client
- `mysql` - MySQL client
- `redis-cli` - Redis client

### Python Libraries
- `psycopg2` - PostgreSQL adapter
- `pymysql` - MySQL adapter
- `redis` - Redis client
- `requests`, `httpx` - HTTP clients
- `pymongo` - MongoDB client
- `boto3` - AWS SDK (for Spaces)

### System Tools
- `htop`, `top`, `ps` - Process monitoring
- `free`, `df` - Memory and disk usage
- `lsof` - List open files
- `strace` - System call tracing
- `jq` - JSON processor
- `vim`, `less` - Text editors/viewers

## Usage

### HTTP Diagnostic Endpoints

When deployed as a service, the container exposes these endpoints:

| Endpoint | Description |
|----------|-------------|
| `/` | List all available endpoints |
| `/health` | Health check (returns `{"status": "healthy"}`) |
| `/env` | Show environment variables (sensitive values redacted) |
| `/dns?host=example.com` | DNS lookup for a host |
| `/connectivity?url=https://api.example.com` | Test HTTP connectivity |
| `/db/postgres` | Test PostgreSQL (uses `DATABASE_URL`) |
| `/db/mysql` | Test MySQL (uses `MYSQL_URL`) |
| `/db/redis` | Test Redis (uses `REDIS_URL`) |
| `/system` | System resource information |

### Shell Access

Access the container shell using `doctl`:

```bash
# List your apps
doctl apps list

# Get console access
doctl apps console <app-id> <component-name>
```

Or use the [do-app-sandbox SDK](https://github.com/digitalocean/do-app-sandbox) for programmatic access.

### Diagnostic Scripts

Once in the shell, run the included diagnostic scripts:

```bash
# Full system diagnostic report
/app/scripts/diagnose.sh

# Test database connectivity
/app/scripts/test-db.sh postgres
/app/scripts/test-db.sh mysql
/app/scripts/test-db.sh redis

# Test network connectivity
/app/scripts/test-connectivity.sh https://api.example.com
/app/scripts/test-connectivity.sh db.example.com 5432
```

### Common Diagnostic Commands

```bash
# Check memory and disk
free -m
df -h

# View running processes
ps aux
htop

# Check listening ports
ss -tlnp

# Test DNS resolution
dig +short your-database.db.ondigitalocean.com

# Test database connectivity
pg_isready -h $PGHOST -p $PGPORT

# Test HTTP endpoint
curl -v https://api.example.com/health

# Check environment variables
env | sort | grep -i database
```

## Environment Variables

The container respects these environment variables for database testing:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `POSTGRES_URL` | Alternative PostgreSQL URL |
| `MYSQL_URL` | MySQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | HTTP server port (default: 8080) |

## Common Issues & Solutions

### "bind: address already in use"
Your app is trying to use a port that's already bound. Check `PORT` environment variable.

### "ECONNREFUSED" to database
Database not attached or wrong connection string. Verify database binding in app spec.

### "ModuleNotFoundError"
Missing Python dependency. Check `requirements.txt`.

### Exit code 137
Out of memory. Increase instance size or optimize memory usage.

### "Health check failed"
Your `/health` endpoint isn't responding. Use this container to debug the endpoint.

### DNS resolution fails
Internal DNS might need time to propagate. Wait 1-2 minutes after creating resources.

## SDK Prompt Compatibility

The container sets `PS1='\u@\h:\w\$ '` for compatibility with the do-app-sandbox SDK, which uses pexpect to detect command completion.

## Security Notes

- The `/env` endpoint redacts values for keys containing: KEY, SECRET, PASSWORD, TOKEN, CREDENTIAL
- Deploy as a worker (not service) in production to avoid public exposure
- Remove the debug container after troubleshooting is complete

## License

MIT
