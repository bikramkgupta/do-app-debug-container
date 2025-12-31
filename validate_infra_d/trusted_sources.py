#!/usr/bin/env python3
"""Trusted sources and VPC validation module."""

import os
import sys
import subprocess
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    has_vpc_interface, get_vpc_ip, tcp_check, dns_check
)


def get_public_ip() -> str:
    """Get the container's public/egress IP address."""
    endpoints = [
        'https://api.ipify.org',
        'https://icanhazip.com',
        'https://ifconfig.me/ip',
    ]

    import urllib.request

    for endpoint in endpoints:
        try:
            req = urllib.request.Request(endpoint)
            req.add_header('User-Agent', 'curl/7.68.0')
            response = urllib.request.urlopen(req, timeout=5)
            ip = response.read().decode().strip()
            if ip and '.' in ip:  # Basic IPv4 check
                return ip
        except Exception:
            continue

    return None


def get_network_interfaces() -> list:
    """Get all network interfaces and their IPs."""
    interfaces = []

    try:
        result = subprocess.run(['ip', '-o', 'addr'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 4 and parts[2] == 'inet':
                iface = parts[1]
                ip = parts[3].split('/')[0]
                interfaces.append((iface, ip))
    except Exception:
        pass

    return interfaces


def check_vpc_configuration() -> tuple:
    """Check VPC network configuration."""
    vpc_ip = get_vpc_ip()

    if vpc_ip:
        return True, f"VPC IP: {vpc_ip}"
    else:
        return True, "No VPC interface (using public network)"


def check_egress_ip() -> tuple:
    """Check and display the egress IP."""
    ip = get_public_ip()

    if ip:
        return True, f"Egress IP: {ip}"
    else:
        return False, "Could not determine egress IP"


def check_private_endpoint_access(url: str, service_name: str) -> tuple:
    """
    Check if a private endpoint is accessible.

    Returns (success, message).
    """
    from urllib.parse import urlparse

    if not url:
        return None, f"No private URL for {service_name}"

    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port

    if not host:
        return False, f"Invalid private URL for {service_name}"

    # Check if it's a private IP
    is_private = host.startswith('10.') or host.startswith('private-')

    if not is_private:
        return None, f"{service_name} URL is not private"

    success, msg = tcp_check(host, port, timeout=5)
    return success, msg


def check_public_endpoint_blocked(url: str, service_name: str) -> tuple:
    """
    Check if public endpoint is blocked (as expected when using trusted sources).

    Returns (expected_blocked, message).
    """
    from urllib.parse import urlparse

    if not url:
        return None, f"No public URL for {service_name}"

    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port

    if not host:
        return None, f"Invalid URL for {service_name}"

    # Skip if it's already a private endpoint
    if host.startswith('10.') or host.startswith('private-'):
        return None, "Already using private endpoint"

    success, msg = tcp_check(host, port, timeout=5)

    if success:
        return True, f"Public endpoint accessible (trusted sources may not be configured)"
    else:
        if 'refused' in msg.lower() or 'timed out' in msg.lower():
            return True, f"Public endpoint blocked (trusted sources working)"
        return False, msg


def check_metadata_service() -> tuple:
    """Check access to DO metadata service."""
    success, msg = tcp_check('169.254.169.254', 80, timeout=2)

    if success:
        # Try to get metadata
        import urllib.request
        try:
            req = urllib.request.Request('http://169.254.169.254/metadata/v1/id')
            response = urllib.request.urlopen(req, timeout=2)
            droplet_id = response.read().decode().strip()
            return True, f"Metadata service accessible (ID: {droplet_id[:20]}...)"
        except Exception:
            return True, "Metadata service reachable but couldn't read"
    else:
        return True, "Metadata service not available (may be normal for App Platform)"


def run_checks(verbose: bool = False) -> int:
    """Run trusted sources and VPC validation checks."""
    print_header("Trusted Sources / VPC Validation")

    checks = []

    # Network interfaces
    interfaces = get_network_interfaces()
    print_info("Network Interfaces:")
    for iface, ip in interfaces:
        is_vpc = ip.startswith('10.')
        label = " (VPC)" if is_vpc else ""
        print_info(f"  {iface}: {ip}{label}")
    print()

    # VPC configuration
    success, msg = check_vpc_configuration()
    checks.append(('VPC Configuration', success, msg))
    print_check('VPC Configuration', success, msg if verbose or not success else None)

    # Egress IP
    success, msg = check_egress_ip()
    checks.append(('Egress IP', success, msg))
    print_check('Egress IP', success, msg)

    if success:
        ip = msg.split(': ')[1] if ': ' in msg else msg
        print_info(f"\nTo add trusted source, use this IP: {ip}")
        print_info("Command: doctl databases firewalls append <db-id> --rule ip_addr:<ip>")
    print()

    # Metadata service
    success, msg = check_metadata_service()
    checks.append(('Metadata Service', success, msg))
    print_check('DO Metadata Service', success, msg if verbose or not success else None)

    print()

    # Check database private endpoints
    print_info("Checking database endpoint accessibility...")
    print()

    db_configs = [
        ('DATABASE_PRIVATE_URL', 'DATABASE_URL', 'PostgreSQL'),
        ('MYSQL_PRIVATE_URL', 'MYSQL_URL', 'MySQL'),
        ('MONGODB_PRIVATE_URI', 'MONGODB_URI', 'MongoDB'),
        ('REDIS_PRIVATE_URL', 'REDIS_URL', 'Redis/Valkey'),
        ('OPENSEARCH_PRIVATE_URL', 'OPENSEARCH_URL', 'OpenSearch'),
    ]

    for private_key, public_key, service_name in db_configs:
        private_url = os.environ.get(private_key)
        public_url = os.environ.get(public_key)

        # Check private endpoint if in VPC
        if has_vpc_interface() and private_url:
            success, msg = check_private_endpoint_access(private_url, service_name)
            if success is not None:
                checks.append((f'{service_name} Private', success, msg))
                print_check(f'{service_name} (private)', success, msg if verbose or not success else None)

        # Check public endpoint status
        if public_url:
            result, msg = check_public_endpoint_blocked(public_url, service_name)
            if result is not None:
                # This is informational - public being accessible isn't necessarily bad
                print_check(f'{service_name} (public)', result, msg if verbose else None)

    # Summary hints
    print()
    if not has_vpc_interface():
        print_warning("Not in VPC - trusted sources must use egress IP shown above")
        print_info("For VPC connectivity, deploy app with vpc: configuration in app spec")

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
