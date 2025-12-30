#!/bin/bash
# Test network connectivity to a host or URL
# Usage: test-connectivity.sh <url_or_host> [port]

TARGET="$1"
PORT="$2"

if [ -z "$TARGET" ]; then
    echo "Usage: test-connectivity.sh <url_or_host> [port]"
    echo ""
    echo "Examples:"
    echo "  test-connectivity.sh https://api.example.com"
    echo "  test-connectivity.sh db.example.com 5432"
    echo "  test-connectivity.sh redis.example.com 6379"
    exit 1
fi

echo "=== Connectivity Test: $TARGET ==="
echo ""

# If it's a URL (starts with http)
if [[ "$TARGET" =~ ^https?:// ]]; then
    echo "Testing HTTP(S) connectivity..."
    echo ""

    # DNS resolution
    HOST=$(echo "$TARGET" | sed -E 's|https?://([^/:]+).*|\1|')
    echo "1. DNS Resolution for $HOST:"
    dig +short "$HOST" 2>/dev/null || nslookup "$HOST" 2>/dev/null | grep -A2 "Name:"
    echo ""

    # HTTP request
    echo "2. HTTP Request:"
    curl -sv -o /dev/null -w "
   HTTP Code: %{http_code}
   Time to Connect: %{time_connect}s
   Time to First Byte: %{time_starttransfer}s
   Total Time: %{time_total}s
   Remote IP: %{remote_ip}
" -m 15 "$TARGET" 2>&1 | grep -E "(< HTTP|SSL|Time|HTTP Code|Remote IP|Could not|Failed)"
    echo ""

    # SSL certificate info (for HTTPS)
    if [[ "$TARGET" =~ ^https:// ]]; then
        echo "3. SSL Certificate:"
        echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null
    fi

else
    # It's a host:port combination
    if [ -z "$PORT" ]; then
        echo "Error: Port required for non-HTTP targets"
        echo "Usage: test-connectivity.sh <host> <port>"
        exit 1
    fi

    echo "1. DNS Resolution for $TARGET:"
    dig +short "$TARGET" 2>/dev/null || nslookup "$TARGET" 2>/dev/null | grep -A2 "Name:"
    echo ""

    echo "2. TCP Connection to $TARGET:$PORT:"
    if timeout 10 bash -c "echo >/dev/tcp/$TARGET/$PORT" 2>/dev/null; then
        echo "   SUCCESS: Port $PORT is reachable"
    else
        echo "   FAILED: Cannot connect to port $PORT"

        # Try with nc for more details
        if command -v nc &> /dev/null; then
            echo ""
            echo "   Netcat details:"
            nc -zv -w 5 "$TARGET" "$PORT" 2>&1
        fi
    fi
    echo ""

    echo "3. Traceroute (first 10 hops):"
    traceroute -m 10 -w 2 "$TARGET" 2>/dev/null | head -12
fi

echo ""
echo "=== Test Complete ==="
