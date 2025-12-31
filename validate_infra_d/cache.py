#!/usr/bin/env python3
"""Redis/Valkey cache validation module."""

import os
import sys
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret, has_vpc_interface, get_connection_url, parse_url, tcp_check
)


def validate_redis(url: str, verbose: bool = False) -> list:
    """
    Validate Redis/Valkey connectivity and operations.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []
    parsed = parse_url(url)

    # Handle redis:// vs rediss:// (TLS)
    use_ssl = parsed['scheme'] == 'rediss'

    print_info(f"Host: {parsed['host']}:{parsed['port']}")
    print_info(f"TLS: {'enabled' if use_ssl else 'disabled'}")
    if parsed['password']:
        print_info(f"Password: {mask_secret(parsed['password'])}")

    # TCP connectivity
    success, msg = tcp_check(parsed['host'], parsed['port'])
    checks.append(('Redis TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        return checks

    try:
        import redis

        try:
            # Create Redis client
            client = redis.Redis(
                host=parsed['host'],
                port=parsed['port'],
                password=parsed['password'] or None,
                ssl=use_ssl,
                ssl_cert_reqs=None if use_ssl else None,  # Don't verify cert for DO managed
                socket_timeout=10,
                socket_connect_timeout=10,
                decode_responses=True
            )

            # PING test
            response = client.ping()
            if response:
                checks.append(('Redis PING', True, "PONG received"))
                print_check('PING', True)
            else:
                checks.append(('Redis PING', False, "No response"))
                print_check('PING', False, "No response")
                return checks

            # Server info
            try:
                info = client.info('server')
                version = info.get('redis_version', 'unknown')
                checks.append(('Redis Server', True, f"Version: {version}"))
                print_check('Server Info', True, f"Version: {version}" if verbose else None)
            except Exception:
                pass

            # SET/GET test
            test_key = "_validate_infra_test"
            test_value = "test_value_12345"

            try:
                # SET
                client.set(test_key, test_value, ex=60)  # 60 second expiry
                checks.append(('Redis SET', True, f"Set key {test_key}"))
                print_check('SET', True)

                # GET
                result = client.get(test_key)
                if result == test_value:
                    checks.append(('Redis GET', True, "Retrieved correct value"))
                    print_check('GET', True)
                else:
                    checks.append(('Redis GET', False, f"Value mismatch: {result}"))
                    print_check('GET', False, f"Value mismatch")

                # DELETE
                client.delete(test_key)
                checks.append(('Redis DELETE', True, "Deleted test key"))
                print_check('DELETE', True)

                # Verify deletion
                if client.get(test_key) is None:
                    print_check('Cleanup', True, "Key removed")

            except redis.ResponseError as e:
                error_msg = str(e)
                checks.append(('Redis Operations', False, error_msg))
                print_check('Operations', False, error_msg)

                if 'NOAUTH' in error_msg or 'Authentication' in error_msg:
                    print_warning("Authentication required - check REDIS_URL has password")
                elif 'READONLY' in error_msg:
                    print_warning("Connected to read-only replica")

            client.close()

        except redis.ConnectionError as e:
            error_msg = str(e)
            checks.append(('Redis Connection', False, error_msg))
            print_check('Connection', False, error_msg)

            if 'Connection refused' in error_msg:
                print_warning("Check if Redis is running and firewall rules")
            elif 'Connection timed out' in error_msg:
                print_warning("Check network connectivity and trusted sources")

        except redis.AuthenticationError as e:
            checks.append(('Redis Auth', False, str(e)))
            print_check('Authentication', False, str(e))
            print_warning("Check password in REDIS_URL")

    except ImportError:
        checks.append(('Redis Driver', False, "redis-py not installed"))
        print_check('Driver (redis)', False, "pip install redis")

    return checks


def run_checks(verbose: bool = False) -> int:
    """Run Redis/Valkey validation checks."""
    print_header("Redis/Valkey Cache Validation")

    # Environment variable mappings
    url_configs = [
        ('REDIS_URL', 'REDIS_PRIVATE_URL'),
        ('VALKEY_URL', 'VALKEY_PRIVATE_URL'),
        ('CACHE_URL', 'CACHE_PRIVATE_URL'),
    ]

    # Show VPC status
    if has_vpc_interface():
        print_info("VPC detected - will prefer private URLs")
    else:
        print_info("No VPC - using public URLs")
    print()

    url = None
    url_source = None

    for url_key, private_key in url_configs:
        url = get_connection_url(url_key, private_key)
        if url:
            url_source = url_key
            break

    if not url:
        print_warning("No Redis/Valkey URL found in environment variables")
        print_info("Expected environment variables:")
        for url_key, _ in url_configs:
            print_info(f"  - {url_key}")
        return 1

    print_info(f"Found Redis URL in {url_source}")
    print()

    checks = validate_redis(url, verbose)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
