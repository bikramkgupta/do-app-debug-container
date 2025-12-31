#!/usr/bin/env python3
"""Network connectivity validation module."""

import os
import socket
import ssl
import subprocess
from .utils import (
    print_header, print_check, print_info, print_summary,
    has_vpc_interface, get_vpc_ip, tcp_check, dns_check
)


def check_dns_resolution() -> tuple:
    """Check external DNS resolution."""
    test_hosts = [
        'google.com',
        'api.digitalocean.com',
        'registry.digitalocean.com',
    ]

    for host in test_hosts:
        success, result = dns_check(host)
        if not success:
            return False, f"DNS resolution failed for {host}: {result}"

    return True, f"DNS resolution working (tested: {', '.join(test_hosts)})"


def check_external_https() -> tuple:
    """Check external HTTPS connectivity."""
    import urllib.request

    test_urls = [
        ('https://api.digitalocean.com/v2/', 'DigitalOcean API'),
        ('https://www.google.com/', 'Google'),
    ]

    for url, name in test_urls:
        try:
            req = urllib.request.Request(url, method='HEAD')
            urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError:
            # HTTP errors mean we connected successfully
            pass
        except Exception as e:
            return False, f"Failed to connect to {name} ({url}): {e}"

    return True, "External HTTPS connectivity working"


def check_do_api() -> tuple:
    """Check DigitalOcean API accessibility."""
    import urllib.request
    import json

    url = 'https://api.digitalocean.com/v2/'

    try:
        req = urllib.request.Request(url)
        req.add_header('Content-Type', 'application/json')

        # Try to access the API (will fail auth, but that's fine)
        try:
            urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as e:
            # 401, 403, 404 all mean we reached the API
            if e.code in [401, 403, 404]:
                return True, "DigitalOcean API reachable (auth required, as expected)"
            return False, f"DigitalOcean API returned unexpected error: {e.code}"

        return True, "DigitalOcean API reachable"

    except Exception as e:
        return False, f"Failed to reach DigitalOcean API: {e}"


def check_container_registry() -> tuple:
    """Check DigitalOcean Container Registry connectivity."""
    host = 'registry.digitalocean.com'
    port = 443

    success, msg = tcp_check(host, port)
    if not success:
        return False, msg

    # Try HTTPS connection
    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                return True, f"Container Registry reachable (TLS verified)"
    except Exception as e:
        return False, f"Container Registry TLS failed: {e}"


def check_ghcr() -> tuple:
    """Check GitHub Container Registry connectivity."""
    host = 'ghcr.io'
    port = 443

    success, msg = tcp_check(host, port)
    if not success:
        return False, msg

    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=host) as ssock:
                return True, "GitHub Container Registry reachable (TLS verified)"
    except Exception as e:
        return False, f"GHCR TLS failed: {e}"


def check_internal_dns() -> tuple:
    """Check internal service discovery (if in VPC)."""
    if not has_vpc_interface():
        return True, "Not in VPC - internal DNS check skipped"

    # Check for internal DO metadata service
    try:
        success, msg = tcp_check('169.254.169.254', 80, timeout=2)
        if success:
            return True, "Internal metadata service reachable"
        return True, "Internal DNS - metadata service not available (may be normal)"
    except Exception:
        return True, "Internal DNS check skipped"


def check_vpc_connectivity() -> tuple:
    """Check VPC configuration."""
    vpc_ip = get_vpc_ip()

    if vpc_ip:
        return True, f"VPC interface detected: {vpc_ip}"
    else:
        return True, "No VPC interface detected (using public network)"


def run_checks(verbose: bool = False) -> int:
    """Run all network checks and return exit code."""
    print_header("Network Connectivity Validation")

    # Show VPC status
    vpc_ip = get_vpc_ip()
    if vpc_ip:
        print_info(f"VPC detected: {vpc_ip}")
    else:
        print_info("No VPC interface - using public network")

    print()

    checks = []

    # DNS Resolution
    success, msg = check_dns_resolution()
    checks.append(('DNS Resolution', success, msg))
    print_check('DNS Resolution', success, msg if verbose or not success else None)

    # External HTTPS
    success, msg = check_external_https()
    checks.append(('External HTTPS', success, msg))
    print_check('External HTTPS', success, msg if verbose or not success else None)

    # DigitalOcean API
    success, msg = check_do_api()
    checks.append(('DigitalOcean API', success, msg))
    print_check('DigitalOcean API', success, msg if verbose or not success else None)

    # Container Registry
    success, msg = check_container_registry()
    checks.append(('DO Container Registry', success, msg))
    print_check('DO Container Registry', success, msg if verbose or not success else None)

    # GitHub Container Registry
    success, msg = check_ghcr()
    checks.append(('GitHub Container Registry', success, msg))
    print_check('GitHub Container Registry', success, msg if verbose or not success else None)

    # Internal DNS (VPC)
    success, msg = check_internal_dns()
    checks.append(('Internal DNS', success, msg))
    print_check('Internal DNS', success, msg if verbose or not success else None)

    # VPC Connectivity
    success, msg = check_vpc_connectivity()
    checks.append(('VPC Connectivity', success, msg))
    print_check('VPC Connectivity', success, msg if verbose or not success else None)

    return print_summary(checks)


if __name__ == '__main__':
    import sys
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
