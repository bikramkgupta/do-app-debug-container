#!/usr/bin/env python3
"""DigitalOcean Spaces (S3-compatible) validation module."""

import os
import sys
import uuid
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret
)


def get_spaces_config() -> dict:
    """Get Spaces configuration from environment variables."""
    # Get region - try multiple formats
    region = (
        os.environ.get('SPACES_REGION') or
        os.environ.get('DO_SPACES_REGION') or
        os.environ.get('AWS_REGION') or
        'syd1'  # Default to Sydney
    )

    # Normalize region (remove trailing numbers for endpoint)
    # e.g., syd1 -> syd1, nyc3 -> nyc3
    endpoint_region = region

    # Get endpoint
    endpoint = (
        os.environ.get('SPACES_ENDPOINT') or
        os.environ.get('DO_SPACES_ENDPOINT') or
        os.environ.get('AWS_ENDPOINT_URL') or
        f"https://{endpoint_region}.digitaloceanspaces.com"
    )

    return {
        'access_key': os.environ.get('SPACES_ACCESS_KEY') or os.environ.get('DO_SPACES_KEY') or os.environ.get('AWS_ACCESS_KEY_ID'),
        'secret_key': os.environ.get('SPACES_SECRET_KEY') or os.environ.get('DO_SPACES_SECRET') or os.environ.get('AWS_SECRET_ACCESS_KEY'),
        'bucket': os.environ.get('SPACES_BUCKET') or os.environ.get('DO_SPACES_BUCKET') or os.environ.get('S3_BUCKET'),
        'region': region,
        'endpoint': endpoint,
    }


def validate_spaces(config: dict, verbose: bool = False) -> list:
    """
    Validate Spaces connectivity and operations.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []

    print_info(f"Endpoint: {config['endpoint']}")
    print_info(f"Region: {config['region']}")
    print_info(f"Bucket: {config['bucket']}")
    print_info(f"Access Key: {mask_secret(config['access_key'])}")
    print_info(f"Secret Key: {mask_secret(config['secret_key'])}")

    # Validate configuration
    if not config['access_key']:
        checks.append(('Spaces Config', False, "SPACES_ACCESS_KEY not set"))
        print_check('Configuration', False, "Missing access key")
        return checks

    if not config['secret_key']:
        checks.append(('Spaces Config', False, "SPACES_SECRET_KEY not set"))
        print_check('Configuration', False, "Missing secret key")
        return checks

    if not config['bucket']:
        checks.append(('Spaces Config', False, "SPACES_BUCKET not set"))
        print_check('Configuration', False, "Missing bucket name")
        return checks

    try:
        import boto3
        from botocore.exceptions import ClientError, EndpointConnectionError, NoCredentialsError

        # Create S3 client for Spaces
        session = boto3.session.Session()
        client = session.client(
            's3',
            region_name=config['region'],
            endpoint_url=config['endpoint'],
            aws_access_key_id=config['access_key'],
            aws_secret_access_key=config['secret_key'],
        )

        # Test bucket access
        try:
            client.head_bucket(Bucket=config['bucket'])
            checks.append(('Spaces Bucket', True, f"Bucket '{config['bucket']}' accessible"))
            print_check('Bucket Access', True)

        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == '404':
                checks.append(('Spaces Bucket', False, f"Bucket '{config['bucket']}' not found"))
                print_check('Bucket Access', False, "Bucket not found")
                print_warning("Create the bucket or check SPACES_BUCKET name")
            elif error_code == '403':
                checks.append(('Spaces Bucket', False, "Access denied to bucket"))
                print_check('Bucket Access', False, "Access denied")
                print_warning("Check Spaces access key permissions")
            else:
                checks.append(('Spaces Bucket', False, str(e)))
                print_check('Bucket Access', False, str(e))
            return checks

        except EndpointConnectionError as e:
            checks.append(('Spaces Connection', False, f"Cannot reach endpoint: {config['endpoint']}"))
            print_check('Connection', False, "Cannot reach Spaces endpoint")
            print_warning(f"Check SPACES_ENDPOINT or SPACES_REGION")
            return checks

        # Test object operations
        test_key = f"_validate_infra_test/{uuid.uuid4().hex}"
        test_content = b"validate-infra test content"

        try:
            # PUT object
            client.put_object(
                Bucket=config['bucket'],
                Key=test_key,
                Body=test_content,
                ContentType='text/plain'
            )
            checks.append(('Spaces PUT', True, f"Uploaded {test_key}"))
            print_check('PUT Object', True)

            # GET object
            response = client.get_object(Bucket=config['bucket'], Key=test_key)
            retrieved = response['Body'].read()
            if retrieved == test_content:
                checks.append(('Spaces GET', True, "Retrieved correct content"))
                print_check('GET Object', True)
            else:
                checks.append(('Spaces GET', False, "Content mismatch"))
                print_check('GET Object', False, "Content mismatch")

            # HEAD object (check metadata)
            head = client.head_object(Bucket=config['bucket'], Key=test_key)
            size = head.get('ContentLength', 0)
            checks.append(('Spaces HEAD', True, f"Object size: {size} bytes"))
            print_check('HEAD Object', True, f"Size: {size} bytes" if verbose else None)

            # DELETE object
            client.delete_object(Bucket=config['bucket'], Key=test_key)
            checks.append(('Spaces DELETE', True, "Deleted test object"))
            print_check('DELETE Object', True)

            # Verify deletion
            try:
                client.head_object(Bucket=config['bucket'], Key=test_key)
                print_check('Cleanup', False, "Object still exists")
            except ClientError as e:
                if e.response.get('Error', {}).get('Code') == '404':
                    print_check('Cleanup', True, "Object removed")
                else:
                    raise

        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            error_msg = e.response.get('Error', {}).get('Message', str(e))
            checks.append(('Spaces Operations', False, f"{error_code}: {error_msg}"))
            print_check('Operations', False, f"{error_code}: {error_msg}")

            if error_code == 'AccessDenied':
                print_warning("Check Spaces key has write permissions")

            # Try to clean up
            try:
                client.delete_object(Bucket=config['bucket'], Key=test_key)
            except Exception:
                pass

        # List objects (optional, shows permissions)
        try:
            response = client.list_objects_v2(Bucket=config['bucket'], MaxKeys=5)
            obj_count = response.get('KeyCount', 0)
            checks.append(('Spaces LIST', True, f"Can list objects ({obj_count} shown)"))
            print_check('LIST Objects', True)
        except ClientError as e:
            checks.append(('Spaces LIST', False, str(e)))
            print_check('LIST Objects', False, str(e))

    except NoCredentialsError:
        checks.append(('Spaces Credentials', False, "No credentials found"))
        print_check('Credentials', False, "Check SPACES_ACCESS_KEY and SPACES_SECRET_KEY")

    except ImportError:
        checks.append(('Spaces Driver', False, "boto3 not installed"))
        print_check('Driver (boto3)', False, "pip install boto3")

    except Exception as e:
        checks.append(('Spaces Error', False, str(e)))
        print_check('Spaces', False, str(e))

    return checks


def run_checks(verbose: bool = False) -> int:
    """Run Spaces validation checks."""
    print_header("DigitalOcean Spaces Validation")

    config = get_spaces_config()

    if not config['access_key'] or not config['secret_key']:
        print_info("Spaces credentials not configured - skipping Spaces checks")
        print_info("To enable, set these environment variables:")
        print_info("  - SPACES_ACCESS_KEY")
        print_info("  - SPACES_SECRET_KEY")
        print_info("  - SPACES_BUCKET")
        print_info("  - SPACES_REGION (optional, default: syd1)")
        print_info("  - SPACES_ENDPOINT (optional)")
        return 0  # Skip gracefully when not configured

    checks = validate_spaces(config, verbose)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
