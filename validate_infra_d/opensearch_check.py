#!/usr/bin/env python3
"""OpenSearch validation module."""

import os
import sys
from urllib.parse import urlparse
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret, has_vpc_interface, get_connection_url, tcp_check
)


def get_opensearch_config() -> dict:
    """Get OpenSearch configuration from environment variables."""
    # Try full URL first
    url = get_connection_url('OPENSEARCH_URL', 'OPENSEARCH_PRIVATE_URL')

    if url:
        parsed = urlparse(url)
        return {
            'host': parsed.hostname,
            'port': parsed.port or 25060,
            'username': parsed.username or 'doadmin',
            'password': parsed.password or '',
            'use_ssl': parsed.scheme == 'https',
            'url': url,
        }

    # Try individual vars
    host = os.environ.get('OPENSEARCH_HOST') or os.environ.get('OPENSEARCH_HOSTNAME')
    if host:
        return {
            'host': host,
            'port': int(os.environ.get('OPENSEARCH_PORT', '25060')),
            'username': os.environ.get('OPENSEARCH_USERNAME', 'doadmin'),
            'password': os.environ.get('OPENSEARCH_PASSWORD', ''),
            'use_ssl': True,
            'url': None,
        }

    return None


def validate_opensearch(config: dict, verbose: bool = False) -> list:
    """
    Validate OpenSearch connectivity and operations.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []

    print_info(f"Host: {config['host']}:{config['port']}")
    print_info(f"Username: {config['username']}")
    print_info(f"Password: {mask_secret(config['password'])}")
    print_info(f"TLS: {'enabled' if config['use_ssl'] else 'disabled'}")

    # TCP connectivity
    success, msg = tcp_check(config['host'], config['port'])
    checks.append(('OpenSearch TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        return checks

    try:
        from opensearchpy import OpenSearch, RequestsHttpConnection
        from opensearchpy.exceptions import ConnectionError, AuthenticationException

        # Create client
        client = OpenSearch(
            hosts=[{'host': config['host'], 'port': config['port']}],
            http_auth=(config['username'], config['password']),
            use_ssl=config['use_ssl'],
            verify_certs=True,
            ssl_show_warn=False,
            connection_class=RequestsHttpConnection,
            timeout=10,
        )

        # Connection test - cluster health
        try:
            health = client.cluster.health()
            status = health.get('status', 'unknown')
            cluster_name = health.get('cluster_name', 'unknown')

            status_ok = status in ['green', 'yellow']
            checks.append(('OpenSearch Health', status_ok, f"Status: {status}, Cluster: {cluster_name}"))

            if status == 'green':
                print_check('Cluster Health', True, f"Status: {status}")
            elif status == 'yellow':
                print_check('Cluster Health', True, f"Status: {status} (replicas may be missing)")
            else:
                print_check('Cluster Health', False, f"Status: {status}")

        except AuthenticationException as e:
            checks.append(('OpenSearch Auth', False, "Authentication failed"))
            print_check('Authentication', False, str(e))
            print_warning("Check OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD")
            return checks

        except ConnectionError as e:
            checks.append(('OpenSearch Connection', False, str(e)))
            print_check('Connection', False, str(e))
            return checks

        # Cluster info
        try:
            info = client.info()
            version = info.get('version', {}).get('number', 'unknown')
            checks.append(('OpenSearch Version', True, f"Version: {version}"))
            print_check('Server Info', True, f"Version: {version}" if verbose else None)
        except Exception:
            pass

        # List indices
        try:
            indices = client.cat.indices(format='json')
            index_count = len(indices) if isinstance(indices, list) else 0
            checks.append(('OpenSearch Indices', True, f"{index_count} indices found"))
            print_check('List Indices', True, f"{index_count} indices" if verbose else None)
        except Exception as e:
            checks.append(('OpenSearch Indices', False, str(e)))
            print_check('List Indices', False, str(e))

        # Index operations test
        test_index = "_validate_infra_test"
        try:
            # Create index
            if client.indices.exists(index=test_index):
                client.indices.delete(index=test_index)

            client.indices.create(
                index=test_index,
                body={
                    'settings': {'number_of_shards': 1, 'number_of_replicas': 0},
                    'mappings': {'properties': {'test_field': {'type': 'text'}}}
                }
            )
            checks.append(('OpenSearch CREATE', True, f"Created index {test_index}"))
            print_check('CREATE Index', True)

            # Index document
            doc_id = client.index(
                index=test_index,
                body={'test_field': 'test_value'},
                refresh=True
            )['_id']
            checks.append(('OpenSearch INDEX', True, "Indexed document"))
            print_check('INDEX Document', True)

            # Search
            results = client.search(
                index=test_index,
                body={'query': {'match_all': {}}}
            )
            hit_count = results['hits']['total']['value']
            checks.append(('OpenSearch SEARCH', True, f"Found {hit_count} documents"))
            print_check('SEARCH', True)

            # Delete document
            client.delete(index=test_index, id=doc_id, refresh=True)
            checks.append(('OpenSearch DELETE', True, "Deleted document"))
            print_check('DELETE Document', True)

            # Cleanup - delete index
            client.indices.delete(index=test_index)
            print_check('Cleanup', True, "Deleted test index")

        except Exception as e:
            error_msg = str(e)
            checks.append(('OpenSearch Operations', False, error_msg))
            print_check('Operations', False, error_msg)

            # Try to clean up anyway
            try:
                if client.indices.exists(index=test_index):
                    client.indices.delete(index=test_index)
            except Exception:
                pass

        client.close()

    except ImportError:
        checks.append(('OpenSearch Driver', False, "opensearch-py not installed"))
        print_check('Driver', False, "pip install opensearch-py")

    except Exception as e:
        checks.append(('OpenSearch Error', False, str(e)))
        print_check('OpenSearch', False, str(e))

    return checks


def run_checks(verbose: bool = False) -> int:
    """Run OpenSearch validation checks."""
    print_header("OpenSearch Validation")

    # Show VPC status
    if has_vpc_interface():
        print_info("VPC detected - will prefer private URLs")
    else:
        print_info("No VPC - using public URLs")
    print()

    config = get_opensearch_config()

    if not config:
        print_warning("No OpenSearch configuration found")
        print_info("Expected environment variables:")
        print_info("  - OPENSEARCH_URL (https://user:pass@host:port)")
        print_info("  OR")
        print_info("  - OPENSEARCH_HOST, OPENSEARCH_PORT")
        print_info("  - OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD")
        return 1

    checks = validate_opensearch(config, verbose)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
