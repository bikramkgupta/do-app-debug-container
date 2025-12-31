#!/usr/bin/env python3
"""Database validation module for PostgreSQL, MySQL, and MongoDB."""

import os
import sys
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret, has_vpc_interface, get_connection_url, parse_url, tcp_check
)


def validate_postgresql(url: str, verbose: bool = False) -> list:
    """
    Validate PostgreSQL connectivity and permissions.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []
    parsed = parse_url(url)

    print_info(f"Host: {parsed['host']}:{parsed['port']}")
    print_info(f"Database: {parsed['database']}")
    print_info(f"User: {parsed['username']}")
    print_info(f"Password: {mask_secret(parsed['password'])}")

    # TCP connectivity
    success, msg = tcp_check(parsed['host'], parsed['port'])
    checks.append(('PostgreSQL TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        return checks

    try:
        import psycopg2

        # Connection test
        try:
            conn = psycopg2.connect(url)
            checks.append(('PostgreSQL Connection', True, "Connected successfully"))
            print_check('Connection', True)

            cursor = conn.cursor()

            # Query test
            cursor.execute("SELECT version();")
            version = cursor.fetchone()[0]
            checks.append(('PostgreSQL Query', True, version[:60] + "..."))
            print_check('Query (SELECT)', True, version[:60] + "..." if verbose else None)

            # Permission tests - CREATE TABLE
            test_table = "_validate_infra_test"
            try:
                cursor.execute(f"DROP TABLE IF EXISTS {test_table};")
                cursor.execute(f"CREATE TABLE {test_table} (id SERIAL PRIMARY KEY, val TEXT);")
                conn.commit()
                checks.append(('PostgreSQL CREATE', True, f"Created table {test_table}"))
                print_check('CREATE TABLE', True)

                # INSERT
                cursor.execute(f"INSERT INTO {test_table} (val) VALUES ('test');")
                conn.commit()
                checks.append(('PostgreSQL INSERT', True, "Inserted test row"))
                print_check('INSERT', True)

                # SELECT
                cursor.execute(f"SELECT * FROM {test_table};")
                cursor.fetchall()
                checks.append(('PostgreSQL SELECT', True, "Selected from test table"))
                print_check('SELECT', True)

                # UPDATE
                cursor.execute(f"UPDATE {test_table} SET val = 'updated' WHERE id = 1;")
                conn.commit()
                checks.append(('PostgreSQL UPDATE', True, "Updated test row"))
                print_check('UPDATE', True)

                # DELETE
                cursor.execute(f"DELETE FROM {test_table} WHERE id = 1;")
                conn.commit()
                checks.append(('PostgreSQL DELETE', True, "Deleted test row"))
                print_check('DELETE', True)

                # Cleanup
                cursor.execute(f"DROP TABLE {test_table};")
                conn.commit()
                print_check('Cleanup', True, "Dropped test table")

            except psycopg2.Error as e:
                checks.append(('PostgreSQL Permissions', False, str(e)))
                print_check('Permissions', False, str(e))

            cursor.close()
            conn.close()

        except psycopg2.OperationalError as e:
            error_msg = str(e).strip()
            checks.append(('PostgreSQL Connection', False, error_msg))
            print_check('Connection', False, error_msg)

            # Provide actionable hints
            if 'no pg_hba.conf entry' in error_msg or 'not allowed' in error_msg.lower():
                print_warning("Check trusted sources - your IP may not be whitelisted")
            elif 'connection refused' in error_msg.lower():
                print_warning("Database may be down or firewall blocking access")
            elif 'password authentication failed' in error_msg.lower():
                print_warning("Check username/password credentials")

    except ImportError:
        checks.append(('PostgreSQL Driver', False, "psycopg2 not installed"))
        print_check('Driver (psycopg2)', False, "pip install psycopg2-binary")

    return checks


def validate_mysql(url: str, verbose: bool = False) -> list:
    """
    Validate MySQL connectivity and permissions.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []
    parsed = parse_url(url)

    print_info(f"Host: {parsed['host']}:{parsed['port']}")
    print_info(f"Database: {parsed['database']}")
    print_info(f"User: {parsed['username']}")
    print_info(f"Password: {mask_secret(parsed['password'])}")

    # TCP connectivity
    success, msg = tcp_check(parsed['host'], parsed['port'])
    checks.append(('MySQL TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        return checks

    try:
        import pymysql

        # Determine SSL settings
        ssl_settings = None
        if 'ssl-mode' in parsed['params'] or 'sslmode' in parsed['params']:
            ssl_mode = parsed['params'].get('ssl-mode', parsed['params'].get('sslmode', ['']))[0]
            if ssl_mode.upper() in ['REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY', 'require']:
                ssl_settings = {'ssl': {'check_hostname': False}}

        try:
            conn = pymysql.connect(
                host=parsed['host'],
                port=parsed['port'],
                user=parsed['username'],
                password=parsed['password'],
                database=parsed['database'],
                ssl=ssl_settings,
                connect_timeout=10
            )
            checks.append(('MySQL Connection', True, "Connected successfully"))
            print_check('Connection', True)

            cursor = conn.cursor()

            # Query test
            cursor.execute("SELECT VERSION();")
            version = cursor.fetchone()[0]
            checks.append(('MySQL Query', True, f"Version: {version}"))
            print_check('Query (SELECT)', True, f"Version: {version}" if verbose else None)

            # Permission tests
            test_table = "_validate_infra_test"
            try:
                cursor.execute(f"DROP TABLE IF EXISTS {test_table};")
                cursor.execute(f"CREATE TABLE {test_table} (id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255));")
                conn.commit()
                checks.append(('MySQL CREATE', True, f"Created table {test_table}"))
                print_check('CREATE TABLE', True)

                cursor.execute(f"INSERT INTO {test_table} (val) VALUES ('test');")
                conn.commit()
                checks.append(('MySQL INSERT', True, "Inserted test row"))
                print_check('INSERT', True)

                cursor.execute(f"SELECT * FROM {test_table};")
                cursor.fetchall()
                checks.append(('MySQL SELECT', True, "Selected from test table"))
                print_check('SELECT', True)

                cursor.execute(f"UPDATE {test_table} SET val = 'updated' WHERE id = 1;")
                conn.commit()
                checks.append(('MySQL UPDATE', True, "Updated test row"))
                print_check('UPDATE', True)

                cursor.execute(f"DELETE FROM {test_table} WHERE id = 1;")
                conn.commit()
                checks.append(('MySQL DELETE', True, "Deleted test row"))
                print_check('DELETE', True)

                # Cleanup
                cursor.execute(f"DROP TABLE {test_table};")
                conn.commit()
                print_check('Cleanup', True, "Dropped test table")

            except pymysql.Error as e:
                checks.append(('MySQL Permissions', False, str(e)))
                print_check('Permissions', False, str(e))

            cursor.close()
            conn.close()

        except pymysql.OperationalError as e:
            error_msg = str(e)
            checks.append(('MySQL Connection', False, error_msg))
            print_check('Connection', False, error_msg)

            if 'Access denied' in error_msg:
                print_warning("Check username/password or trusted sources")
            elif 'Can\'t connect' in error_msg:
                print_warning("Database may be down or firewall blocking access")

    except ImportError:
        checks.append(('MySQL Driver', False, "pymysql not installed"))
        print_check('Driver (pymysql)', False, "pip install pymysql")

    return checks


def validate_mongodb(url: str, verbose: bool = False) -> list:
    """
    Validate MongoDB connectivity.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []
    parsed = parse_url(url)

    print_info(f"Host: {parsed['host']}")
    print_info(f"Database: {parsed['database']}")
    print_info(f"User: {parsed['username']}")
    print_info(f"Password: {mask_secret(parsed['password'])}")

    # TCP check (skip for SRV records)
    if parsed['scheme'] != 'mongodb+srv':
        success, msg = tcp_check(parsed['host'], parsed['port'])
        checks.append(('MongoDB TCP', success, msg))
        print_check('TCP Connectivity', success, msg if verbose or not success else None)

        if not success:
            return checks

    try:
        from pymongo import MongoClient
        from pymongo.errors import ConnectionFailure, OperationFailure

        try:
            client = MongoClient(url, serverSelectionTimeoutMS=10000)

            # Ping test
            client.admin.command('ping')
            checks.append(('MongoDB Connection', True, "Connected successfully"))
            print_check('Connection', True)

            # Server info
            try:
                info = client.server_info()
                version = info.get('version', 'unknown')
                checks.append(('MongoDB Server', True, f"Version: {version}"))
                print_check('Server Info', True, f"Version: {version}" if verbose else None)
            except Exception:
                pass

            # Database access test
            db_name = parsed['database'] or 'admin'
            db = client[db_name]

            test_collection = "_validate_infra_test"
            try:
                # Insert
                collection = db[test_collection]
                result = collection.insert_one({"test": "value"})
                checks.append(('MongoDB INSERT', True, f"Inserted document"))
                print_check('INSERT', True)

                # Find
                doc = collection.find_one({"_id": result.inserted_id})
                if doc:
                    checks.append(('MongoDB FIND', True, "Found document"))
                    print_check('FIND', True)

                # Update
                collection.update_one({"_id": result.inserted_id}, {"$set": {"test": "updated"}})
                checks.append(('MongoDB UPDATE', True, "Updated document"))
                print_check('UPDATE', True)

                # Delete
                collection.delete_one({"_id": result.inserted_id})
                checks.append(('MongoDB DELETE', True, "Deleted document"))
                print_check('DELETE', True)

                # Cleanup - drop collection
                db.drop_collection(test_collection)
                print_check('Cleanup', True, "Dropped test collection")

            except OperationFailure as e:
                checks.append(('MongoDB Operations', False, str(e)))
                print_check('Operations', False, str(e))

            client.close()

        except ConnectionFailure as e:
            error_msg = str(e)
            checks.append(('MongoDB Connection', False, error_msg))
            print_check('Connection', False, error_msg)

            if 'Authentication failed' in error_msg:
                print_warning("Check username/password credentials")
            elif 'timed out' in error_msg.lower():
                print_warning("Check network/firewall or trusted sources")

    except ImportError:
        checks.append(('MongoDB Driver', False, "pymongo not installed"))
        print_check('Driver (pymongo)', False, "pip install pymongo")

    return checks


def detect_database_type(url: str) -> str:
    """Detect database type from URL scheme."""
    if url.startswith('postgresql://') or url.startswith('postgres://'):
        return 'postgresql'
    elif url.startswith('mysql://'):
        return 'mysql'
    elif url.startswith('mongodb://') or url.startswith('mongodb+srv://'):
        return 'mongodb'
    return None


def run_checks(db_type: str = None, verbose: bool = False) -> int:
    """Run database validation checks."""
    print_header("Database Connectivity Validation")

    all_checks = []

    # Environment variable mappings
    db_configs = {
        'postgresql': [
            ('DATABASE_URL', 'DATABASE_PRIVATE_URL'),
            ('POSTGRES_URL', 'POSTGRES_PRIVATE_URL'),
            ('PG_URL', 'PG_PRIVATE_URL'),
        ],
        'mysql': [
            ('MYSQL_URL', 'MYSQL_PRIVATE_URL'),
            ('MYSQL_DATABASE_URL', 'MYSQL_DATABASE_PRIVATE_URL'),
        ],
        'mongodb': [
            ('MONGODB_URI', 'MONGODB_PRIVATE_URI'),
            ('MONGODB_URL', 'MONGODB_PRIVATE_URL'),
            ('MONGO_URL', 'MONGO_PRIVATE_URL'),
        ],
    }

    # Show VPC status
    if has_vpc_interface():
        print_info("VPC detected - will prefer private URLs")
    else:
        print_info("No VPC - using public URLs")
    print()

    # Determine which databases to check
    types_to_check = [db_type] if db_type else ['postgresql', 'mysql', 'mongodb']

    for dtype in types_to_check:
        if dtype not in db_configs:
            continue

        for url_key, private_key in db_configs[dtype]:
            url = get_connection_url(url_key, private_key)
            if url:
                detected = detect_database_type(url)
                if detected == dtype or detected is None:
                    print_info(f"Found {dtype.upper()} URL in {url_key}")
                    print()

                    if dtype == 'postgresql':
                        checks = validate_postgresql(url, verbose)
                    elif dtype == 'mysql':
                        checks = validate_mysql(url, verbose)
                    elif dtype == 'mongodb':
                        checks = validate_mongodb(url, verbose)
                    else:
                        continue

                    all_checks.extend(checks)
                    print()
                    break

    if not all_checks:
        print_warning("No database URLs found in environment variables")
        print_info("Expected environment variables:")
        for dtype, configs in db_configs.items():
            for url_key, _ in configs:
                print_info(f"  - {url_key}")
        return 1

    return print_summary(all_checks)


if __name__ == '__main__':
    import sys
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    db_type = None
    for arg in sys.argv[1:]:
        if arg in ['postgresql', 'mysql', 'mongodb', 'pg', 'postgres', 'mongo']:
            if arg in ['pg', 'postgres']:
                db_type = 'postgresql'
            elif arg == 'mongo':
                db_type = 'mongodb'
            else:
                db_type = arg
            break
    sys.exit(run_checks(db_type, verbose))
