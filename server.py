#!/usr/bin/env python3
"""
DigitalOcean App Platform Debug Server

A lightweight HTTP server that provides health checks and diagnostic endpoints
for testing connectivity in App Platform deployments.
"""

import http.server
import json
import os
import socket
import subprocess
import sys
import urllib.parse
from datetime import datetime


class DiagnosticHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler for diagnostic endpoints."""

    def do_GET(self):
        """Handle GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        routes = {
            '/': self.handle_index,
            '/health': self.handle_health,
            '/env': self.handle_env,
            '/dns': self.handle_dns,
            '/connectivity': self.handle_connectivity,
            '/db/postgres': self.handle_postgres,
            '/db/mysql': self.handle_mysql,
            '/db/redis': self.handle_redis,
            '/system': self.handle_system,
        }

        handler = routes.get(path, self.handle_not_found)
        handler(query)

    def send_json(self, data, status=200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode())

    def handle_index(self, query):
        """Show available endpoints."""
        self.send_json({
            'service': 'do-app-debug-container',
            'description': 'Debug container for DigitalOcean App Platform',
            'endpoints': {
                '/health': 'Health check endpoint',
                '/env': 'Show environment variables (filtered)',
                '/dns?host=example.com': 'DNS lookup for a host',
                '/connectivity?url=https://example.com': 'Test HTTP connectivity',
                '/db/postgres': 'Test PostgreSQL connectivity (uses DATABASE_URL)',
                '/db/mysql': 'Test MySQL connectivity (uses MYSQL_URL)',
                '/db/redis': 'Test Redis connectivity (uses REDIS_URL)',
                '/system': 'System resource information',
            },
            'shell_access': 'Use doctl apps console or do-app-sandbox SDK',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    def handle_health(self, query):
        """Health check endpoint."""
        self.send_json({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        })

    def handle_env(self, query):
        """Show filtered environment variables."""
        # Filter out sensitive values
        sensitive_patterns = ['KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL']
        env_vars = {}
        for key, value in sorted(os.environ.items()):
            if any(pattern in key.upper() for pattern in sensitive_patterns):
                env_vars[key] = '[REDACTED]'
            else:
                env_vars[key] = value
        self.send_json({
            'environment': env_vars,
            'count': len(env_vars),
        })

    def handle_dns(self, query):
        """Perform DNS lookup."""
        host = query.get('host', [''])[0]
        if not host:
            self.send_json({'error': 'Missing host parameter'}, 400)
            return

        try:
            result = subprocess.run(
                ['dig', '+short', host],
                capture_output=True, text=True, timeout=10
            )
            addresses = result.stdout.strip().split('\n')
            self.send_json({
                'host': host,
                'addresses': [a for a in addresses if a],
                'status': 'resolved' if addresses[0] else 'no_records',
            })
        except subprocess.TimeoutExpired:
            self.send_json({'host': host, 'error': 'DNS lookup timeout'}, 504)
        except Exception as e:
            self.send_json({'host': host, 'error': str(e)}, 500)

    def handle_connectivity(self, query):
        """Test HTTP connectivity to a URL."""
        url = query.get('url', [''])[0]
        if not url:
            self.send_json({'error': 'Missing url parameter'}, 400)
            return

        try:
            result = subprocess.run(
                ['curl', '-s', '-o', '/dev/null', '-w',
                 '{"http_code":%{http_code},"time_total":%{time_total},"time_connect":%{time_connect}}',
                 '-m', '10', url],
                capture_output=True, text=True, timeout=15
            )
            stats = json.loads(result.stdout)
            self.send_json({
                'url': url,
                'status': 'reachable' if stats['http_code'] > 0 else 'unreachable',
                'http_code': stats['http_code'],
                'time_connect_seconds': stats['time_connect'],
                'time_total_seconds': stats['time_total'],
            })
        except Exception as e:
            self.send_json({'url': url, 'error': str(e)}, 500)

    def handle_postgres(self, query):
        """Test PostgreSQL connectivity."""
        db_url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL')
        if not db_url:
            self.send_json({
                'status': 'not_configured',
                'error': 'DATABASE_URL or POSTGRES_URL not set',
            }, 400)
            return

        try:
            import psycopg2
            conn = psycopg2.connect(db_url, connect_timeout=10)
            cursor = conn.cursor()
            cursor.execute('SELECT version();')
            version = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            self.send_json({
                'status': 'connected',
                'database': 'postgresql',
                'version': version,
            })
        except Exception as e:
            self.send_json({
                'status': 'connection_failed',
                'database': 'postgresql',
                'error': str(e),
            }, 500)

    def handle_mysql(self, query):
        """Test MySQL connectivity."""
        db_url = os.environ.get('MYSQL_URL') or os.environ.get('DATABASE_URL')
        if not db_url:
            self.send_json({
                'status': 'not_configured',
                'error': 'MYSQL_URL or DATABASE_URL not set',
            }, 400)
            return

        try:
            import pymysql
            # Parse URL: mysql://user:pass@host:port/database
            from urllib.parse import urlparse
            parsed = urlparse(db_url)
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
            cursor.close()
            conn.close()
            self.send_json({
                'status': 'connected',
                'database': 'mysql',
                'version': version,
            })
        except Exception as e:
            self.send_json({
                'status': 'connection_failed',
                'database': 'mysql',
                'error': str(e),
            }, 500)

    def handle_redis(self, query):
        """Test Redis connectivity."""
        redis_url = os.environ.get('REDIS_URL')
        if not redis_url:
            self.send_json({
                'status': 'not_configured',
                'error': 'REDIS_URL not set',
            }, 400)
            return

        try:
            import redis
            r = redis.from_url(redis_url, socket_connect_timeout=10)
            info = r.info('server')
            self.send_json({
                'status': 'connected',
                'database': 'redis',
                'version': info.get('redis_version', 'unknown'),
            })
        except Exception as e:
            self.send_json({
                'status': 'connection_failed',
                'database': 'redis',
                'error': str(e),
            }, 500)

    def handle_system(self, query):
        """Get system resource information."""
        try:
            # Memory info
            mem_result = subprocess.run(['free', '-m'], capture_output=True, text=True)
            mem_lines = mem_result.stdout.strip().split('\n')

            # Disk info
            disk_result = subprocess.run(['df', '-h', '/'], capture_output=True, text=True)

            # Process count
            ps_result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
            process_count = len(ps_result.stdout.strip().split('\n')) - 1

            self.send_json({
                'memory': mem_lines,
                'disk': disk_result.stdout.strip().split('\n'),
                'process_count': process_count,
                'hostname': socket.gethostname(),
            })
        except Exception as e:
            self.send_json({'error': str(e)}, 500)

    def handle_not_found(self, query):
        """Handle unknown routes."""
        self.send_json({'error': 'Not found', 'path': self.path}, 404)

    def log_message(self, format, *args):
        """Log HTTP requests."""
        print(f"[{datetime.utcnow().isoformat()}] {args[0]}")


def main():
    port = int(os.environ.get('PORT', 8080))
    server = http.server.HTTPServer(('0.0.0.0', port), DiagnosticHandler)
    print(f"Debug server starting on port {port}")
    print(f"Endpoints: /, /health, /env, /dns, /connectivity, /db/postgres, /db/mysql, /db/redis, /system")
    server.serve_forever()


if __name__ == '__main__':
    main()
