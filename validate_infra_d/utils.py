#!/usr/bin/env python3
"""Shared utilities for infrastructure validation."""

import os
import subprocess
import sys

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
CYAN = '\033[0;36m'
BOLD = '\033[1m'
NC = '\033[0m'  # No Color


def mask_secret(secret: str, show: int = 4) -> str:
    """Mask a secret, showing only the first N characters."""
    if not secret:
        return "<empty>"
    if len(secret) <= show:
        return "*" * len(secret)
    return secret[:show] + "*" * (len(secret) - show)


def print_header(title: str) -> None:
    """Print a section header."""
    print(f"\n{BOLD}{CYAN}{'=' * 60}{NC}")
    print(f"{BOLD}{CYAN}{title:^60}{NC}")
    print(f"{BOLD}{CYAN}{'=' * 60}{NC}\n")


def print_check(name: str, passed: bool, message: str = None) -> None:
    """Print a check result with color coding."""
    status = f"{GREEN}PASS{NC}" if passed else f"{RED}FAIL{NC}"
    print(f"  [{status}] {name}")
    if message:
        indent = "        "
        for line in message.split('\n'):
            print(f"{indent}{line}")


def print_warning(message: str) -> None:
    """Print a warning message."""
    print(f"  [{YELLOW}WARN{NC}] {message}")


def print_info(message: str) -> None:
    """Print an info message."""
    print(f"  [{BLUE}INFO{NC}] {message}")


def print_summary(checks: list) -> int:
    """
    Print a summary of all checks.

    Args:
        checks: List of tuples (name, passed, message)

    Returns:
        Exit code: 0 if all passed, 1 if any failed
    """
    passed = sum(1 for _, p, _ in checks if p)
    failed = sum(1 for _, p, _ in checks if not p)
    total = len(checks)

    print(f"\n{BOLD}{'=' * 60}{NC}")
    print(f"{BOLD}Summary:{NC} {passed}/{total} checks passed")

    if failed > 0:
        print(f"\n{RED}Failed checks:{NC}")
        for name, p, msg in checks:
            if not p:
                print(f"  - {name}")
                if msg:
                    print(f"    {msg}")

    print(f"{'=' * 60}\n")

    return 0 if failed == 0 else 1


def has_vpc_interface() -> bool:
    """
    Check if container has VPC network interface.
    VPC IPs in DigitalOcean start with 10.x.x.x
    """
    try:
        result = subprocess.run(['ip', 'addr'], capture_output=True, text=True, timeout=5)
        # Check for 10.x.x.x addresses (DO VPC range)
        lines = result.stdout.split('\n')
        for line in lines:
            if 'inet 10.' in line:
                return True
        return False
    except Exception:
        return False


def get_vpc_ip() -> str:
    """Get the VPC IP address if available."""
    try:
        result = subprocess.run(['ip', 'addr'], capture_output=True, text=True, timeout=5)
        lines = result.stdout.split('\n')
        for line in lines:
            if 'inet 10.' in line:
                # Extract IP from line like "    inet 10.116.0.2/20 brd 10.116.15.255 scope global eth0"
                parts = line.strip().split()
                for i, part in enumerate(parts):
                    if part == 'inet' and i + 1 < len(parts):
                        return parts[i + 1].split('/')[0]
        return None
    except Exception:
        return None


def get_connection_url(url_key: str, private_url_key: str = None) -> str:
    """
    Get the appropriate connection URL based on VPC configuration.

    Priority:
    1. Private URL if VPC detected and private URL available
    2. Public URL otherwise

    Args:
        url_key: Environment variable for public URL
        private_url_key: Environment variable for private URL

    Returns:
        The appropriate connection URL
    """
    if private_url_key and has_vpc_interface():
        private_url = os.environ.get(private_url_key)
        if private_url:
            return private_url
    return os.environ.get(url_key)


def parse_url(url: str) -> dict:
    """
    Parse a database URL into components.

    Supports formats:
    - postgresql://user:pass@host:port/dbname?sslmode=require
    - mysql://user:pass@host:port/dbname?ssl-mode=REQUIRED
    - mongodb+srv://user:pass@host/dbname?tls=true
    - redis://:pass@host:port
    - rediss://:pass@host:port (TLS)
    """
    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(url)

    result = {
        'scheme': parsed.scheme,
        'username': parsed.username or '',
        'password': parsed.password or '',
        'host': parsed.hostname or '',
        'port': parsed.port,
        'database': parsed.path.lstrip('/') if parsed.path else '',
        'params': parse_qs(parsed.query)
    }

    # Set default ports based on scheme
    if result['port'] is None:
        defaults = {
            'postgresql': 5432,
            'postgres': 5432,
            'mysql': 3306,
            'mongodb': 27017,
            'mongodb+srv': 27017,
            'redis': 6379,
            'rediss': 6379,
        }
        result['port'] = defaults.get(result['scheme'], None)

    return result


def tcp_check(host: str, port: int, timeout: float = 5.0) -> tuple:
    """
    Check TCP connectivity to a host:port.

    Returns:
        Tuple of (success: bool, message: str)
    """
    import socket

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()

        if result == 0:
            return True, f"TCP connection to {host}:{port} successful"
        else:
            return False, f"TCP connection to {host}:{port} failed (error code: {result})"
    except socket.timeout:
        return False, f"TCP connection to {host}:{port} timed out after {timeout}s"
    except socket.gaierror as e:
        return False, f"DNS resolution failed for {host}: {e}"
    except Exception as e:
        return False, f"TCP connection error: {e}"


def dns_check(hostname: str) -> tuple:
    """
    Check DNS resolution for a hostname.

    Returns:
        Tuple of (success: bool, ips: list or error message)
    """
    import socket

    try:
        ips = socket.gethostbyname_ex(hostname)[2]
        return True, ips
    except socket.gaierror as e:
        return False, f"DNS resolution failed: {e}"
    except Exception as e:
        return False, f"DNS error: {e}"


def run_command(cmd: list, timeout: float = 30.0) -> tuple:
    """
    Run a shell command and return the result.

    Returns:
        Tuple of (success: bool, stdout: str, stderr: str)
    """
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out after {timeout}s"
    except Exception as e:
        return False, "", str(e)
