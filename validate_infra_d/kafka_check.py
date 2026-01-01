#!/usr/bin/env python3
"""Kafka validation module."""

import os
import sys
import tempfile
from .utils import (
    print_header, print_check, print_info, print_warning, print_summary,
    mask_secret, tcp_check
)


def get_kafka_config() -> dict:
    """Get Kafka configuration from environment variables."""
    config = {
        'broker': os.environ.get('KAFKA_BROKER') or os.environ.get('KAFKA_BROKERS'),
        'username': os.environ.get('KAFKA_USERNAME'),
        'password': os.environ.get('KAFKA_PASSWORD'),
        'ca_cert': os.environ.get('KAFKA_CA_CERT') or os.environ.get('CA_CERT'),
    }

    # Handle multiple formats for broker
    if not config['broker']:
        host = os.environ.get('KAFKA_HOST') or os.environ.get('KAFKA_HOSTNAME')
        port = os.environ.get('KAFKA_PORT', '25073')
        if host:
            config['broker'] = f"{host}:{port}"

    return config


def write_ca_cert(ca_cert: str) -> str:
    """Write CA certificate to a temporary file and return the path."""
    if not ca_cert:
        return None

    # Handle certificate that might be escaped or have literal \n
    cert_content = ca_cert.replace('\\n', '\n')

    # Write to temp file
    fd, path = tempfile.mkstemp(suffix='.pem', prefix='kafka_ca_')
    with os.fdopen(fd, 'w') as f:
        f.write(cert_content)

    return path


def validate_kafka(config: dict, verbose: bool = False) -> list:
    """
    Validate Kafka connectivity and operations.

    Returns list of (check_name, passed, message) tuples.
    """
    checks = []

    broker = config['broker']
    if not broker:
        checks.append(('Kafka Config', False, "No broker configured"))
        print_check('Configuration', False, "KAFKA_BROKER not set")
        return checks

    # Parse broker host:port
    if ':' in broker:
        host, port = broker.rsplit(':', 1)
        port = int(port)
    else:
        host = broker
        port = 9092

    print_info(f"Broker: {host}:{port}")
    if config['username']:
        print_info(f"Username: {config['username']}")
    if config['password']:
        print_info(f"Password: {mask_secret(config['password'])}")
    if config['ca_cert']:
        print_info(f"CA Cert: configured ({len(config['ca_cert'])} bytes)")

    # TCP connectivity
    success, msg = tcp_check(host, port)
    checks.append(('Kafka TCP', success, msg))
    print_check('TCP Connectivity', success, msg if verbose or not success else None)

    if not success:
        print_warning("Kafka uses port 25073 on DigitalOcean - verify KAFKA_BROKER")
        return checks

    ca_cert_path = None
    try:
        # Try confluent_kafka first (better for DO managed Kafka)
        try:
            from confluent_kafka import Consumer, Producer, KafkaError, KafkaException
            from confluent_kafka.admin import AdminClient, NewTopic

            # Write CA cert if provided
            ca_cert_path = write_ca_cert(config['ca_cert'])

            # Build configuration
            conf = {
                'bootstrap.servers': f"{host}:{port}",
                'security.protocol': 'SASL_SSL',
                'sasl.mechanism': 'SCRAM-SHA-256',
                'sasl.username': config['username'],
                'sasl.password': config['password'],
                'socket.timeout.ms': 10000,
                'session.timeout.ms': 10000,
            }

            if ca_cert_path:
                conf['ssl.ca.location'] = ca_cert_path

            # Admin client for metadata and topic management
            admin = AdminClient(conf)
            import time
            test_topic = f"_validate_infra_test_{int(time.time() * 1000)}"
            topic_created = False

            # List topics (tests connectivity)
            try:
                metadata = admin.list_topics(timeout=10)
                topic_count = len(metadata.topics)
                checks.append(('Kafka Connection', True, f"Connected, {topic_count} topics found"))
                print_check('Connection', True, f"{topic_count} topics available" if verbose else None)

                # List some topics
                if verbose:
                    topics = list(metadata.topics.keys())[:5]
                    if topics:
                        print_info(f"Topics (first 5): {', '.join(topics)}")

            except KafkaException as e:
                error_msg = str(e)
                checks.append(('Kafka Connection', False, error_msg))
                print_check('Connection', False, error_msg)

                if 'Authentication' in error_msg or 'SASL' in error_msg:
                    print_warning("Check KAFKA_USERNAME and KAFKA_PASSWORD")
                elif 'SSL' in error_msg or 'certificate' in error_msg.lower():
                    print_warning("Check KAFKA_CA_CERT - may need valid CA certificate")
                return checks

            # Create test topic
            try:
                new_topic = NewTopic(test_topic, num_partitions=1, replication_factor=1)
                futures = admin.create_topics([new_topic], operation_timeout=10)

                # Wait for topic creation
                for topic, future in futures.items():
                    future.result()  # Raises exception on failure

                topic_created = True
                checks.append(('Kafka CREATE Topic', True, f"Created {test_topic}"))
                print_check('CREATE Topic', True)

                # Give the cluster a moment to propagate topic metadata
                time.sleep(1)

            except Exception as e:
                error_msg = str(e)
                checks.append(('Kafka CREATE Topic', False, error_msg))
                print_check('CREATE Topic', False, error_msg)
                return checks

            # Producer test - send a message
            test_message_value = f"test-value-{int(time.time() * 1000)}"
            try:
                producer_conf = conf.copy()
                producer_conf['client.id'] = 'validate-infra-producer'

                producer = Producer(producer_conf)

                delivered = [False]
                error_holder = [None]

                def delivery_callback(err, msg):
                    if err:
                        error_holder[0] = err
                    else:
                        delivered[0] = True

                producer.produce(
                    test_topic,
                    key='test-key',
                    value=test_message_value,
                    callback=delivery_callback
                )
                producer.flush(timeout=10)

                if delivered[0]:
                    checks.append(('Kafka PRODUCE', True, "Message sent"))
                    print_check('PRODUCE', True)
                elif error_holder[0]:
                    error_msg = str(error_holder[0])
                    checks.append(('Kafka PRODUCE', False, error_msg))
                    print_check('PRODUCE', False, error_msg)
                else:
                    checks.append(('Kafka PRODUCE', False, "Message not acknowledged"))
                    print_check('PRODUCE', False, "Message not acknowledged")

            except Exception as e:
                checks.append(('Kafka PRODUCE', False, str(e)))
                print_check('PRODUCE', False, str(e))

            # Consumer test - consume the message
            try:
                consumer_conf = conf.copy()
                consumer_conf['group.id'] = f'validate-infra-{int(time.time() * 1000)}'
                consumer_conf['auto.offset.reset'] = 'earliest'
                consumer_conf['enable.auto.commit'] = False

                consumer = Consumer(consumer_conf)
                consumer.subscribe([test_topic])

                # Poll for messages with timeout
                message_received = False
                start_time = time.time()
                timeout_seconds = 15

                while time.time() - start_time < timeout_seconds:
                    msg = consumer.poll(timeout=1.0)
                    if msg is None:
                        continue
                    if msg.error():
                        if msg.error().code() == KafkaError._PARTITION_EOF:
                            continue
                        else:
                            raise KafkaException(msg.error())

                    if msg.value() and msg.value().decode('utf-8') == test_message_value:
                        message_received = True
                        break

                consumer.close()

                if message_received:
                    checks.append(('Kafka CONSUME', True, "Message received"))
                    print_check('CONSUME', True)
                else:
                    checks.append(('Kafka CONSUME', False, "Timeout waiting for message"))
                    print_check('CONSUME', False, "Timeout waiting for message")

            except Exception as e:
                checks.append(('Kafka CONSUME', False, str(e)))
                print_check('CONSUME', False, str(e))

            # Cleanup - delete test topic
            if topic_created:
                try:
                    futures = admin.delete_topics([test_topic], operation_timeout=10)
                    for topic, future in futures.items():
                        future.result()
                    print_check('Cleanup', True, "Deleted test topic")
                except Exception as e:
                    print_warning(f"Failed to delete test topic: {e}")

        except ImportError:
            # Fall back to kafka-python-ng
            from kafka import KafkaConsumer, KafkaProducer, KafkaAdminClient
            from kafka.admin import NewTopic as KafkaTopic
            from kafka.errors import KafkaError
            import time

            ssl_context = None
            if config['ca_cert']:
                import ssl
                ca_cert_path = write_ca_cert(config['ca_cert'])
                ssl_context = ssl.create_default_context()
                ssl_context.load_verify_locations(ca_cert_path)

            test_topic = f"_validate_infra_test_{int(time.time() * 1000)}"
            topic_created = False

            # Admin client
            admin = KafkaAdminClient(
                bootstrap_servers=f"{host}:{port}",
                security_protocol='SASL_SSL',
                sasl_mechanism='SCRAM-SHA-256',
                sasl_plain_username=config['username'],
                sasl_plain_password=config['password'],
                ssl_context=ssl_context,
                request_timeout_ms=10000,
            )

            # List topics (tests connectivity)
            topics = admin.list_topics()
            checks.append(('Kafka Connection', True, f"Connected, {len(topics)} topics"))
            print_check('Connection', True, f"{len(topics)} topics" if verbose else None)

            # Create test topic
            try:
                new_topic = KafkaTopic(name=test_topic, num_partitions=1, replication_factor=1)
                admin.create_topics([new_topic])
                topic_created = True
                checks.append(('Kafka CREATE Topic', True, f"Created {test_topic}"))
                print_check('CREATE Topic', True)
                time.sleep(1)
            except Exception as e:
                checks.append(('Kafka CREATE Topic', False, str(e)))
                print_check('CREATE Topic', False, str(e))
                admin.close()
                return checks

            # Producer test
            test_message_value = f"test-value-{int(time.time() * 1000)}"
            try:
                producer = KafkaProducer(
                    bootstrap_servers=f"{host}:{port}",
                    security_protocol='SASL_SSL',
                    sasl_mechanism='SCRAM-SHA-256',
                    sasl_plain_username=config['username'],
                    sasl_plain_password=config['password'],
                    ssl_context=ssl_context,
                )
                future = producer.send(test_topic, key=b'test-key', value=test_message_value.encode())
                future.get(timeout=10)
                producer.close()
                checks.append(('Kafka PRODUCE', True, "Message sent"))
                print_check('PRODUCE', True)
            except Exception as e:
                checks.append(('Kafka PRODUCE', False, str(e)))
                print_check('PRODUCE', False, str(e))

            # Consumer test
            try:
                consumer = KafkaConsumer(
                    test_topic,
                    bootstrap_servers=f"{host}:{port}",
                    security_protocol='SASL_SSL',
                    sasl_mechanism='SCRAM-SHA-256',
                    sasl_plain_username=config['username'],
                    sasl_plain_password=config['password'],
                    ssl_context=ssl_context,
                    auto_offset_reset='earliest',
                    consumer_timeout_ms=15000,
                    group_id=f'validate-infra-{int(time.time() * 1000)}',
                )

                message_received = False
                for msg in consumer:
                    if msg.value and msg.value.decode('utf-8') == test_message_value:
                        message_received = True
                        break

                consumer.close()

                if message_received:
                    checks.append(('Kafka CONSUME', True, "Message received"))
                    print_check('CONSUME', True)
                else:
                    checks.append(('Kafka CONSUME', False, "Message not found"))
                    print_check('CONSUME', False, "Message not found")
            except Exception as e:
                checks.append(('Kafka CONSUME', False, str(e)))
                print_check('CONSUME', False, str(e))

            # Cleanup
            if topic_created:
                try:
                    admin.delete_topics([test_topic])
                    print_check('Cleanup', True, "Deleted test topic")
                except Exception as e:
                    print_warning(f"Failed to delete test topic: {e}")

            admin.close()

    except ImportError:
        checks.append(('Kafka Driver', False, "No Kafka client installed"))
        print_check('Driver', False, "pip install confluent-kafka or kafka-python-ng")

    except Exception as e:
        error_msg = str(e)
        checks.append(('Kafka Error', False, error_msg))
        print_check('Kafka', False, error_msg)

    finally:
        # Clean up temp CA cert file
        if ca_cert_path and os.path.exists(ca_cert_path):
            try:
                os.remove(ca_cert_path)
            except Exception:
                pass

    return checks


def run_checks(verbose: bool = False) -> int:
    """Run Kafka validation checks."""
    print_header("Kafka Validation")

    print_info("Note: Kafka does NOT support trusted sources on DigitalOcean")
    print_info("It uses SASL/SCRAM authentication instead")
    print()

    config = get_kafka_config()

    if not config['broker']:
        print_info("No Kafka broker configured - skipping Kafka checks")
        print_info("To enable, set these environment variables:")
        print_info("  - KAFKA_BROKER (host:port)")
        print_info("  - KAFKA_USERNAME")
        print_info("  - KAFKA_PASSWORD")
        print_info("  - KAFKA_CA_CERT (optional)")
        return 0  # Skip gracefully when not configured

    checks = validate_kafka(config, verbose)

    return print_summary(checks)


if __name__ == '__main__':
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    sys.exit(run_checks(verbose))
