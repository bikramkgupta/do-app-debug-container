#!/usr/bin/env python3
"""Environment variable validation module."""

import os
import sys
import re
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret
)


# Common environment variable patterns
COMMON_REQUIRED_VARS = [
    'DATABASE_URL',
    'REDIS_URL',
]

# URL format patterns
URL_PATTERNS = {
    'postgresql': re.compile(r'^postgres(ql)?://[^:]+:[^@]+@[^:/]+:\d+/.+'),
    'mysql': re.compile(r'^mysql://[^:]+:[^@]+@[^:/]+:\d+/.+'),
    'mongodb': re.compile(r'^mongodb(\+srv)?://[^:]+:[^@]+@[^/]+/.+'),
    'redis': re.compile(r'^rediss?://[^@]*@?[^:/]+:\d+'),
    'http': re.compile(r'^https?://.+'),
}

# Bindable variable pattern (unresolved)
BINDABLE_PATTERN = re.compile(r'\$\{[^}]+\}')


def check_required_vars(required: list) -> list:
    """
    Check that required environment variables are set.

    Returns list of (var_name, is_set, value_preview) tuples.
    """
    results = []

    for var in required:
        value = os.environ.get(var)
        if value:
            # Check for unresolved bindable variables
            if BINDABLE_PATTERN.search(value):
                results.append((var, False, f"Unresolved: {value[:50]}"))
            else:
                results.append((var, True, mask_secret(value, 8)))
        else:
            results.append((var, False, "Not set"))

    return results


def check_url_format(var_name: str, url: str) -> tuple:
    """
    Validate URL format for a variable.

    Returns (is_valid, message).
    """
    if not url:
        return False, "Empty URL"

    # Check for unresolved bindable variables
    if BINDABLE_PATTERN.search(url):
        matches = BINDABLE_PATTERN.findall(url)
        return False, f"Unresolved variables: {', '.join(matches[:3])}"

    # Try to match against known patterns
    for url_type, pattern in URL_PATTERNS.items():
        if pattern.match(url):
            return True, f"Valid {url_type} URL format"

    # Check if it at least looks like a URL
    if '://' in url:
        return True, "URL format (unknown scheme)"

    return False, "Invalid URL format"


def check_secrets_not_exposed() -> list:
    """
    Check that secrets are not accidentally exposed in non-secret vars.

    Returns list of warnings.
    """
    warnings = []

    secret_patterns = [
        (r'password', ['PASSWORD', 'PASS', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL']),
        (r'[a-zA-Z0-9]{32,}', ['KEY', 'SECRET', 'TOKEN']),  # Long random strings
    ]

    # Check for common misconfigurations
    for var, value in os.environ.items():
        if not value:
            continue

        # Skip known secret variables
        if any(s in var.upper() for s in ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL']):
            continue

        # Check for passwords in non-secret vars
        if 'password=' in value.lower() and 'URL' not in var.upper():
            warnings.append(f"{var} may contain exposed password")

    return warnings


def get_all_do_vars() -> dict:
    """Get all DigitalOcean-related environment variables."""
    prefixes = [
        'DATABASE_', 'REDIS_', 'MONGO', 'MYSQL_', 'POSTGRES_', 'PG_',
        'KAFKA_', 'OPENSEARCH_', 'SPACES_', 'DO_', 'DIGITALOCEAN_',
        'MODEL_', 'INFERENCE_', 'GRADIENT_', 'CA_CERT', 'APP_',
    ]

    result = {}
    for var, value in sorted(os.environ.items()):
        if any(var.startswith(p) or var.upper().startswith(p) for p in prefixes):
            result[var] = value

    return result


def run_checks(required: list = None, verbose: bool = False) -> int:
    """Run environment variable validation checks."""
    print_header("Environment Variable Validation")

    checks = []

    # Use provided required vars or defaults
    required_vars = required if required else COMMON_REQUIRED_VARS

    # Check required variables
    print_info("Checking required variables...")
    print()

    required_results = check_required_vars(required_vars)
    for var, is_set, preview in required_results:
        checks.append((f"Env: {var}", is_set, preview))
        print_check(var, is_set, preview if verbose or not is_set else None)

    print()

    # Show all DO-related vars
    do_vars = get_all_do_vars()
    if do_vars:
        print_info(f"Found {len(do_vars)} DigitalOcean-related variables:")
        print()

        for var, value in do_vars.items():
            # Determine if it's a secret
            is_secret = any(s in var.upper() for s in ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL', 'CERT'])

            # Check for issues
            has_issue = False
            issue_msg = None

            if BINDABLE_PATTERN.search(value):
                has_issue = True
                issue_msg = f"Unresolved: {value[:40]}"

            if has_issue:
                checks.append((f"Env: {var}", False, issue_msg))
                print_check(var, False, issue_msg)
            else:
                display_value = mask_secret(value, 8) if is_secret else (value[:40] + '...' if len(value) > 40 else value)
                if verbose:
                    print_info(f"  {var}={display_value}")

    # Check URL formats
    print()
    print_info("Validating URL formats...")
    print()

    url_vars = [
        'DATABASE_URL', 'DATABASE_PRIVATE_URL',
        'MYSQL_URL', 'MYSQL_PRIVATE_URL',
        'REDIS_URL', 'REDIS_PRIVATE_URL',
        'MONGODB_URI', 'MONGODB_PRIVATE_URI',
        'OPENSEARCH_URL', 'OPENSEARCH_PRIVATE_URL',
        'INFERENCE_ENDPOINT',
    ]

    for var in url_vars:
        value = os.environ.get(var)
        if value:
            is_valid, msg = check_url_format(var, value)
            checks.append((f"URL: {var}", is_valid, msg))
            print_check(f"{var} format", is_valid, msg if verbose or not is_valid else None)

    # Check for exposed secrets
    print()
    warnings = check_secrets_not_exposed()
    for warning in warnings:
        print_warning(warning)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv

    # Parse --required flag
    required = None
    for i, arg in enumerate(sys.argv):
        if arg == '--required' and i + 1 < len(sys.argv):
            required = sys.argv[i + 1].split(',')
            break

    sys.exit(run_checks(required, verbose))
