/**
 * Kafka validation module.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  tcpCheck,
  CheckResult,
} from './utils';

interface KafkaConfig {
  broker: string | undefined;
  username: string | undefined;
  password: string | undefined;
  caCert: string | undefined;
}

/**
 * Get Kafka configuration from environment variables.
 */
function getKafkaConfig(): KafkaConfig {
  let broker = process.env.KAFKA_BROKER || process.env.KAFKA_BROKERS;

  // Handle multiple formats for broker
  if (!broker) {
    const host = process.env.KAFKA_HOST || process.env.KAFKA_HOSTNAME;
    const port = process.env.KAFKA_PORT || '25073';
    if (host) {
      broker = `${host}:${port}`;
    }
  }

  return {
    broker,
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
    caCert: process.env.KAFKA_CA_CERT || process.env.CA_CERT,
  };
}

/**
 * Write CA certificate to a temporary file and return the path.
 */
function writeCaCert(caCert: string | undefined): string | null {
  if (!caCert) {
    return null;
  }

  // Handle certificate that might be escaped or have literal \n
  const certContent = caCert.replace(/\\n/g, '\n');

  // Write to temp file
  const tempDir = os.tmpdir();
  const certPath = path.join(tempDir, `kafka_ca_${Date.now()}.pem`);
  fs.writeFileSync(certPath, certContent);

  return certPath;
}

/**
 * Validate Kafka connectivity and operations.
 */
async function validateKafka(config: KafkaConfig, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const broker = config.broker;
  if (!broker) {
    checks.push({ name: 'Kafka Config', passed: false, message: 'No broker configured' });
    printCheck('Configuration', false, 'KAFKA_BROKER not set');
    return checks;
  }

  // Parse broker host:port
  let host: string;
  let port: number;
  if (broker.includes(':')) {
    const parts = broker.split(':');
    host = parts.slice(0, -1).join(':');
    port = parseInt(parts[parts.length - 1], 10);
  } else {
    host = broker;
    port = 9092;
  }

  printInfo(`Broker: ${host}:${port}`);
  if (config.username) {
    printInfo(`Username: ${config.username}`);
  }
  if (config.password) {
    printInfo(`Password: ${maskSecret(config.password)}`);
  }
  if (config.caCert) {
    printInfo(`CA Cert: configured (${config.caCert.length} bytes)`);
  }

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(host, port);
  checks.push({ name: 'Kafka TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    printWarning('Kafka uses port 25073 on DigitalOcean - verify KAFKA_BROKER');
    return checks;
  }

  let caCertPath: string | null = null;
  try {
    const { Kafka, logLevel } = await import('kafkajs');

    // Write CA cert if provided
    caCertPath = writeCaCert(config.caCert);

    // Build SSL configuration
    const ssl: any = {
      rejectUnauthorized: true,
    };
    if (caCertPath) {
      ssl.ca = [fs.readFileSync(caCertPath, 'utf-8')];
    }

    // Build SASL configuration
    const sasl = config.username && config.password
      ? {
          mechanism: 'scram-sha-256' as const,
          username: config.username,
          password: config.password,
        }
      : undefined;

    const kafka = new Kafka({
      clientId: 'validate-infra',
      brokers: [`${host}:${port}`],
      ssl,
      sasl,
      connectionTimeout: 10000,
      requestTimeout: 10000,
      logLevel: logLevel.NOTHING,
    });

    // Admin client for metadata and topic management
    const admin = kafka.admin();
    const testTopic = `_validate_infra_test_${Date.now()}`;
    let topicCreated = false;

    try {
      await admin.connect();

      // List topics (tests connectivity)
      const topics = await admin.listTopics();
      checks.push({
        name: 'Kafka Connection',
        passed: true,
        message: `Connected, ${topics.length} topics found`,
      });
      printCheck('Connection', true, verbose ? `${topics.length} topics available` : undefined);

      // List some topics
      if (topics.length > 0 && verbose) {
        const displayTopics = topics.slice(0, 5);
        printInfo(`Topics (first 5): ${displayTopics.join(', ')}`);
      }

      // Create test topic
      try {
        await admin.createTopics({
          topics: [{ topic: testTopic, numPartitions: 1, replicationFactor: 1 }],
          waitForLeaders: true,
          timeout: 10000,
        });
        topicCreated = true;
        checks.push({ name: 'Kafka CREATE Topic', passed: true, message: `Created ${testTopic}` });
        printCheck('CREATE Topic', true);
      } catch (err) {
        const error = err as Error;
        checks.push({ name: 'Kafka CREATE Topic', passed: false, message: error.message });
        printCheck('CREATE Topic', false, error.message);
        // Can't continue without topic
        await admin.disconnect();
        return checks;
      }
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      checks.push({ name: 'Kafka Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      if (errorMsg.includes('Authentication') || errorMsg.includes('SASL')) {
        printWarning('Check KAFKA_USERNAME and KAFKA_PASSWORD');
      } else if (errorMsg.includes('SSL') || errorMsg.toLowerCase().includes('certificate')) {
        printWarning('Check KAFKA_CA_CERT - may need valid CA certificate');
      }
      return checks;
    }

    // Producer test - send a message
    const testMessage = { key: 'test-key', value: `test-value-${Date.now()}` };
    try {
      const producer = kafka.producer();
      await producer.connect();

      await producer.send({
        topic: testTopic,
        messages: [testMessage],
      });
      checks.push({ name: 'Kafka PRODUCE', passed: true, message: 'Message sent' });
      printCheck('PRODUCE', true);

      await producer.disconnect();
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'Kafka PRODUCE', passed: false, message: error.message });
      printCheck('PRODUCE', false, error.message);
    }

    // Consumer test - consume the message
    try {
      const consumer = kafka.consumer({ groupId: `validate-infra-${Date.now()}` });
      await consumer.connect();
      await consumer.subscribe({ topic: testTopic, fromBeginning: true });

      let messageReceived = false;
      const consumePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!messageReceived) {
            reject(new Error('Timeout waiting for message'));
          }
        }, 10000);

        consumer.run({
          eachMessage: async ({ message }) => {
            if (message.value?.toString() === testMessage.value) {
              messageReceived = true;
              clearTimeout(timeout);
              resolve();
            }
          },
        });
      });

      await consumePromise;
      checks.push({ name: 'Kafka CONSUME', passed: true, message: 'Message received' });
      printCheck('CONSUME', true);

      await consumer.disconnect();
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'Kafka CONSUME', passed: false, message: error.message });
      printCheck('CONSUME', false, error.message);
    }

    // Cleanup - delete test topic
    if (topicCreated) {
      try {
        await admin.deleteTopics({ topics: [testTopic], timeout: 10000 });
        printCheck('Cleanup', true, 'Deleted test topic');
      } catch (err) {
        // Ignore cleanup errors but log them
        const error = err as Error;
        printWarning(`Failed to delete test topic: ${error.message}`);
      }
    }

    await admin.disconnect();
  } catch (importErr) {
    checks.push({ name: 'Kafka Driver', passed: false, message: 'kafkajs not installed' });
    printCheck('Driver', false, 'npm install kafkajs');
  } finally {
    // Clean up temp CA cert file
    if (caCertPath && fs.existsSync(caCertPath)) {
      try {
        fs.unlinkSync(caCertPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return checks;
}

/**
 * Run Kafka validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('Kafka Validation');

  printInfo('Note: Kafka does NOT support trusted sources on DigitalOcean');
  printInfo('It uses SASL/SCRAM authentication instead');
  console.log();

  const config = getKafkaConfig();

  if (!config.broker) {
    printInfo('No Kafka broker configured - skipping Kafka checks');
    printInfo('To enable, set these environment variables:');
    printInfo('  - KAFKA_BROKER (host:port)');
    printInfo('  - KAFKA_USERNAME');
    printInfo('  - KAFKA_PASSWORD');
    printInfo('  - KAFKA_CA_CERT (optional)');
    return 0; // Skip gracefully when not configured
  }

  const checks = await validateKafka(config, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
