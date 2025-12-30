#!/bin/bash
# Test DigitalOcean Spaces connectivity
# Usage: test-spaces.sh
#
# Required environment variables:
#   SPACES_KEY        - Spaces access key
#   SPACES_SECRET     - Spaces secret key
#   SPACES_ENDPOINT   - Spaces endpoint (e.g., nyc3.digitaloceanspaces.com)
#   SPACES_BUCKET     - Bucket name (optional, lists buckets if not set)

set -euo pipefail

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

# Check required environment variables
if [ -z "${SPACES_KEY:-}" ] || [ -z "${SPACES_SECRET:-}" ]; then
    echo -e "${RED}Error: SPACES_KEY and SPACES_SECRET must be set${NC}"
    echo ""
    echo "Required environment variables:"
    echo "  SPACES_KEY       Your Spaces access key"
    echo "  SPACES_SECRET    Your Spaces secret key"
    echo "  SPACES_ENDPOINT  Spaces endpoint (e.g., nyc3.digitaloceanspaces.com)"
    echo "  SPACES_BUCKET    Bucket name (optional)"
    exit 1
fi

ENDPOINT="${SPACES_ENDPOINT:-nyc3.digitaloceanspaces.com}"
BUCKET="${SPACES_BUCKET:-}"

echo "Testing DigitalOcean Spaces connectivity..."
echo "Endpoint: $ENDPOINT"
echo "Runtime: $RUNTIME"
echo ""

test_spaces_python() {
    python3 << PYEOF
import boto3
import os
import sys
from botocore.config import Config

key = os.environ.get('SPACES_KEY')
secret = os.environ.get('SPACES_SECRET')
endpoint = os.environ.get('SPACES_ENDPOINT', 'nyc3.digitaloceanspaces.com')
bucket = os.environ.get('SPACES_BUCKET', '')

# Configure the client
session = boto3.session.Session()
client = session.client(
    's3',
    region_name=endpoint.split('.')[0],  # Extract region from endpoint
    endpoint_url=f'https://{endpoint}',
    aws_access_key_id=key,
    aws_secret_access_key=secret
)

try:
    if bucket:
        # List objects in specific bucket
        print(f'Listing objects in bucket: {bucket}')
        response = client.list_objects_v2(Bucket=bucket, MaxKeys=10)
        print(f'\033[0;32mSUCCESS\033[0m: Connected to Spaces')
        print(f'Bucket: {bucket}')
        objects = response.get('Contents', [])
        print(f'Objects (first 10): {len(objects)}')
        for obj in objects[:5]:
            print(f'  - {obj["Key"]} ({obj["Size"]} bytes)')
        if len(objects) > 5:
            print(f'  ... and {len(objects) - 5} more')
    else:
        # List all buckets
        print('Listing all buckets...')
        response = client.list_buckets()
        print(f'\033[0;32mSUCCESS\033[0m: Connected to Spaces')
        buckets = response.get('Buckets', [])
        print(f'Buckets found: {len(buckets)}')
        for b in buckets:
            print(f'  - {b["Name"]}')

except Exception as e:
    print(f'\033[0;31mFAILED\033[0m: {e}')
    sys.exit(1)
PYEOF
}

test_spaces_node() {
    node << 'NODEEOF'
const { S3Client, ListBucketsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const key = process.env.SPACES_KEY;
const secret = process.env.SPACES_SECRET;
const endpoint = process.env.SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com';
const bucket = process.env.SPACES_BUCKET || '';
const region = endpoint.split('.')[0];

const client = new S3Client({
    endpoint: `https://${endpoint}`,
    region: region,
    credentials: {
        accessKeyId: key,
        secretAccessKey: secret
    }
});

async function testSpaces() {
    try {
        if (bucket) {
            console.log(`Listing objects in bucket: ${bucket}`);
            const response = await client.send(new ListObjectsV2Command({
                Bucket: bucket,
                MaxKeys: 10
            }));
            console.log('\x1b[32mSUCCESS\x1b[0m: Connected to Spaces');
            console.log(`Bucket: ${bucket}`);
            const objects = response.Contents || [];
            console.log(`Objects (first 10): ${objects.length}`);
            objects.slice(0, 5).forEach(obj => {
                console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
            });
            if (objects.length > 5) {
                console.log(`  ... and ${objects.length - 5} more`);
            }
        } else {
            console.log('Listing all buckets...');
            const response = await client.send(new ListBucketsCommand({}));
            console.log('\x1b[32mSUCCESS\x1b[0m: Connected to Spaces');
            const buckets = response.Buckets || [];
            console.log(`Buckets found: ${buckets.length}`);
            buckets.forEach(b => {
                console.log(`  - ${b.Name}`);
            });
        }
    } catch (err) {
        console.log('\x1b[31mFAILED\x1b[0m:', err.message);
        process.exit(1);
    }
}

testSpaces();
NODEEOF
}

if [ "$RUNTIME" = "python" ]; then
    test_spaces_python
else
    test_spaces_node
fi
