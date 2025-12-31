# Debug Container Testing with Claude

This guide explains how to use the debug container with Claude for end-to-end infrastructure validation testing.

## Overview

The `validate-infra` script tests connectivity to DigitalOcean managed services. It doesn't configure anything - it simply tests what's given to it via environment variables.

**Key principle:** The script doesn't care about VPC or trusted sources. Configuration complexity lives in:
1. App spec YAML files (different URLs, VPC settings)
2. Orchestrator (on laptop) configures databases before testing

## The Four Test Scenarios

| # | Scenario | App VPC | DB Trusted Sources | URL Type | Use Case |
|---|----------|---------|-------------------|----------|----------|
| 1 | Plain | No | Disabled | Public | Quick testing, development |
| 2 | Public + TS | No | Enabled | Public | Security testing over public network |
| 3 | VPC only | Yes | Disabled | Private | VPC routing validation |
| 4 | VPC + TS | Yes | Enabled | Private | Production-like security |

## Test Spec Files

```
app-specs/
├── validate-infra-test-1-plain.yaml      # No VPC, no TS
├── validate-infra-test-2-public-ts.yaml  # No VPC, TS enabled
├── validate-infra-test-3-vpc-only.yaml   # VPC, no TS
└── validate-infra-test-4-vpc-ts.yaml     # VPC + TS (production-like)
```

## How to Instruct Claude

### Scenario 1: Plain Connectivity Test

```
Run validate-infra scenario 1 (plain connectivity).

Steps:
1. Disable trusted sources on all validate-* databases
2. Deploy app-specs/validate-infra-test-1-plain.yaml
3. Connect to the container and run: validate-infra all -v
4. Report results
```

### Scenario 2: Public + Trusted Sources Test

```
Run validate-infra scenario 2 (public + trusted sources).

Steps:
1. Deploy app-specs/validate-infra-test-2-public-ts.yaml
2. Get the app's public egress IP (run curl -s https://api.ipify.org from inside container)
3. Add that IP to trusted sources on all validate-* databases (except Kafka - it doesn't support TS)
4. Run: validate-infra all -v
5. Report results
```

### Scenario 3: VPC Only Test

```
Run validate-infra scenario 3 (VPC only).

Steps:
1. Disable trusted sources on all validate-* databases
2. Deploy app-specs/validate-infra-test-3-vpc-only.yaml
3. Verify VPC interface exists (ip addr should show 10.x.x.x)
4. Run: validate-infra all -v
5. Report results
```

### Scenario 4: VPC + Trusted Sources (Production-like)

```
Run validate-infra scenario 4 (VPC + trusted sources).

Steps:
1. Deploy app-specs/validate-infra-test-4-vpc-ts.yaml
2. Get VPC egress IP: doctl apps get $APP_ID -o json | jq -r '.egress_ips[0].ip'
3. Add that VPC IP to trusted sources on all databases (except Kafka)
4. Run: validate-infra all -v
5. Report results
```

## Database IDs Reference

For trusted sources configuration:

| Database | Cluster ID | Trusted Sources |
|----------|-----------|-----------------|
| PostgreSQL | `59d3c472-38eb-47a1-8d11-ffa765bf95a1` | Supported |
| MySQL | `da436338-01eb-483e-a68f-623b9ff8a984` | Supported |
| MongoDB | `f28070b0-b494-4963-8cdc-22801d86ed78` | Supported |
| Valkey | `fcbd4135-5d5a-4b90-975b-fb0332397318` | Supported |
| OpenSearch | `86016b20-ac4d-47f8-8e4b-fd9c5d0a3dab` | Supported |
| Kafka | `8915dcf9-391d-4ea6-94ac-d4ffa145e116` | **NOT SUPPORTED** |

## Orchestrator Commands

### Disable Trusted Sources (for scenarios 1 & 3)

```bash
# List current firewall rules
doctl databases firewalls list $DB_ID

# Remove all rules (allows all connections)
doctl databases firewalls remove $DB_ID --uuid <rule-uuid>
```

### Enable Trusted Sources (for scenarios 2 & 4)

```bash
# Add IP to trusted sources
doctl databases firewalls append $DB_ID --rule ip_addr:$EGRESS_IP
```

### Deploy App

```bash
# Create new app
doctl apps create --spec app-specs/validate-infra-test-X-xxx.yaml

# Update existing app
doctl apps update $APP_ID --spec app-specs/validate-infra-test-X-xxx.yaml
```

### Get Egress IPs

```bash
# Public egress IP (from inside container)
curl -s https://api.ipify.org

# VPC egress IP (from outside, requires doctl)
doctl apps get $APP_ID -o json | jq -r '.egress_ips[0].ip'
```

### Connect to Container

```bash
# Via web console or SSH if configured
doctl apps console $APP_ID debug

# Or use the SDK
python -m do_app_sandbox.cli exec $APP_ID debug "validate-infra all -v"
```

## validate-infra Commands

```bash
validate-infra all          # Run all checks
validate-infra database     # Test PostgreSQL, MySQL, MongoDB
validate-infra cache        # Test Redis/Valkey
validate-infra kafka        # Test Kafka
validate-infra opensearch   # Test OpenSearch
validate-infra spaces       # Test S3-compatible storage
validate-infra gradient     # Test Gradient AI
validate-infra network      # Test DNS, HTTPS, registries
validate-infra env          # Validate environment variables

# Add -v for verbose output
validate-infra all -v
```

## Expected Results

### All Tests Pass
```
[OK] PostgreSQL connection successful
[OK] MySQL connection successful
[OK] MongoDB connection successful
[OK] Redis/Valkey PING successful
[OK] Kafka broker accessible
[OK] OpenSearch cluster healthy
[OK] Spaces bucket accessible
[OK] Gradient AI models available
```

### Connection Refused (Trusted Sources Blocking)
```
[FAIL] PostgreSQL connection refused
       -> Check if egress IP is in database trusted sources
```

### DNS Resolution Failed (Private URL without VPC)
```
[FAIL] Cannot resolve private-validate-postgres-xxx.db.ondigitalocean.com
       -> Using private URL but app doesn't have VPC enabled
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection refused | Trusted sources blocking | Add egress IP to DB firewall |
| DNS resolution fails | Using private URL without VPC | Use public URL or enable VPC |
| Authentication failed | Wrong credentials | Check DATABASE_URL in app spec |
| Timeout | Network routing issue | Check VPC configuration |
| Kafka fails with VPC+TS | Kafka doesn't support TS | Disable TS on Kafka cluster |

## VPC Configuration

**Sydney VPC ID:** `20ccc9c3-2bad-40dc-9669-8d5ef784b765`
**VPC IP Range:** `10.126.0.0/20`

When VPC is enabled, the app gets a private IP in this range for database connections.
