#!/usr/bin/env python3
"""Gradient AI (DigitalOcean Serverless Inference) validation module."""

import os
import sys
import json
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret, tcp_check, dns_check
)


def get_gradient_config() -> dict:
    """Get Gradient AI configuration from environment variables."""
    return {
        'access_key': os.environ.get('MODEL_ACCESS_KEY') or os.environ.get('GRADIENT_ACCESS_KEY') or os.environ.get('DO_AI_ACCESS_KEY'),
        'endpoint': os.environ.get('INFERENCE_ENDPOINT') or os.environ.get('GRADIENT_ENDPOINT') or 'https://inference.do-ai.run',
    }


def validate_gradient(config: dict, verbose: bool = False) -> list:
    """
    Validate Gradient AI connectivity and API access.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []

    print_info(f"Endpoint: {config['endpoint']}")
    if config['access_key']:
        print_info(f"Access Key: {mask_secret(config['access_key'])}")
    else:
        print_info("Access Key: not configured")

    # Parse endpoint for host
    from urllib.parse import urlparse
    parsed = urlparse(config['endpoint'])
    host = parsed.hostname
    port = parsed.port or 443

    # DNS check
    success, result = dns_check(host)
    checks.append(('Gradient DNS', success, str(result) if not success else f"Resolved: {result}"))
    print_check('DNS Resolution', success, str(result)[:60] if verbose or not success else None)

    if not success:
        return checks

    # TCP connectivity
    success, msg = tcp_check(host, port)
    checks.append(('Gradient TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        return checks

    # HTTPS check
    import urllib.request
    import urllib.error
    import ssl

    try:
        # Test basic HTTPS connectivity
        ctx = ssl.create_default_context()
        req = urllib.request.Request(f"{config['endpoint']}/", method='HEAD')
        try:
            urllib.request.urlopen(req, timeout=10, context=ctx)
            checks.append(('Gradient HTTPS', True, "HTTPS connection successful"))
            print_check('HTTPS Connection', True)
        except urllib.error.HTTPError as e:
            # Any HTTP error means we connected
            checks.append(('Gradient HTTPS', True, f"HTTPS working (HTTP {e.code})"))
            print_check('HTTPS Connection', True)
    except Exception as e:
        checks.append(('Gradient HTTPS', False, str(e)))
        print_check('HTTPS Connection', False, str(e))
        return checks

    # API authentication check
    if not config['access_key']:
        print_info("MODEL_ACCESS_KEY not configured - skipping API checks")
        print_info("Network connectivity verified. To enable API checks, set:")
        print_info("  - MODEL_ACCESS_KEY")
        # Return only the successful network checks (DNS, TCP, HTTPS)
        return checks

    try:
        import requests

        headers = {
            'Authorization': f"Bearer {config['access_key']}",
            'Content-Type': 'application/json',
        }

        # Test API - list models
        models_url = f"{config['endpoint']}/v1/models"
        try:
            response = requests.get(models_url, headers=headers, timeout=10)

            if response.status_code == 200:
                data = response.json()
                models = data.get('data', [])
                model_count = len(models)
                checks.append(('Gradient API', True, f"API accessible, {model_count} models"))
                print_check('API Access', True, f"{model_count} models available" if verbose else None)

                # List available models
                if models and verbose:
                    print_info("Available models:")
                    for model in models[:5]:
                        model_id = model.get('id', 'unknown')
                        print_info(f"  - {model_id}")

                # Test specific model availability
                test_models = [
                    'meta-llama/Llama-3.3-70B-Instruct',
                    'meta-llama/Llama-3.1-8B-Instruct',
                    'mistralai/Mistral-7B-Instruct-v0.3',
                ]

                for test_model in test_models:
                    model_ids = [m.get('id', '') for m in models]
                    if test_model in model_ids:
                        checks.append(('Gradient Model', True, f"{test_model} available"))
                        print_check(f'Model: {test_model.split("/")[-1]}', True)
                        break
                else:
                    if models:
                        first_model = models[0].get('id', 'unknown')
                        checks.append(('Gradient Model', True, f"Found model: {first_model}"))
                        print_check(f'Model Available', True, first_model[:40])

            elif response.status_code == 401:
                checks.append(('Gradient Auth', False, "Invalid access key"))
                print_check('Authentication', False, "Invalid MODEL_ACCESS_KEY")
                print_warning("Check MODEL_ACCESS_KEY in DigitalOcean console")

            elif response.status_code == 403:
                checks.append(('Gradient Auth', False, "Access forbidden"))
                print_check('Authentication', False, "Access forbidden")
                print_warning("Check MODEL_ACCESS_KEY permissions")

            else:
                checks.append(('Gradient API', False, f"HTTP {response.status_code}: {response.text[:100]}"))
                print_check('API Access', False, f"HTTP {response.status_code}")

        except requests.exceptions.Timeout:
            checks.append(('Gradient API', False, "Request timed out"))
            print_check('API Access', False, "Timeout")

        except requests.exceptions.RequestException as e:
            checks.append(('Gradient API', False, str(e)))
            print_check('API Access', False, str(e)[:60])

    except ImportError:
        # Fall back to urllib
        try:
            req = urllib.request.Request(
                f"{config['endpoint']}/v1/models",
                headers={
                    'Authorization': f"Bearer {config['access_key']}",
                    'Content-Type': 'application/json',
                }
            )
            response = urllib.request.urlopen(req, timeout=10)
            data = json.loads(response.read().decode())
            models = data.get('data', [])
            checks.append(('Gradient API', True, f"{len(models)} models available"))
            print_check('API Access', True)

        except urllib.error.HTTPError as e:
            if e.code == 401:
                checks.append(('Gradient Auth', False, "Invalid access key"))
                print_check('Authentication', False, "Invalid MODEL_ACCESS_KEY")
            else:
                checks.append(('Gradient API', False, f"HTTP {e.code}"))
                print_check('API Access', False, f"HTTP {e.code}")

        except Exception as e:
            checks.append(('Gradient API', False, str(e)))
            print_check('API Access', False, str(e)[:60])

    return checks


def run_checks(verbose: bool = False) -> int:
    """Run Gradient AI validation checks."""
    print_header("Gradient AI (Serverless Inference) Validation")

    config = get_gradient_config()

    if not config['endpoint']:
        print_warning("Gradient AI endpoint not configured")
        config['endpoint'] = 'https://inference.do-ai.run'
        print_info(f"Using default endpoint: {config['endpoint']}")

    checks = validate_gradient(config, verbose)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
