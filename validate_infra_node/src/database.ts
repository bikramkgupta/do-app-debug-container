/**
 * Database validation module for PostgreSQL, MySQL, and MongoDB.
 */

import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  hasVpcInterface,
  getConnectionUrl,
  parseUrl,
  tcpCheck,
  CheckResult,
} from './utils';

/**
 * Validate PostgreSQL connectivity and permissions.
 */
async function validatePostgresql(url: string, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const parsed = parseUrl(url);

  printInfo(`Host: ${parsed.host}:${parsed.port}`);
  printInfo(`Database: ${parsed.database}`);
  printInfo(`User: ${parsed.username}`);
  printInfo(`Password: ${maskSecret(parsed.password)}`);

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(parsed.host, parsed.port!);
  checks.push({ name: 'PostgreSQL TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    return checks;
  }

  try {
    const { Client } = await import('pg');

    // Use explicit config instead of connectionString to properly set SSL options
    // When using connectionString with sslmode=require, pg overrides the ssl option
    const client = new Client({
      host: parsed.host,
      port: parsed.port || undefined,
      user: parsed.username,
      password: parsed.password,
      database: parsed.database,
      ssl: { rejectUnauthorized: false }, // Required for DO managed databases (self-signed certs)
    });

    try {
      await client.connect();
      checks.push({ name: 'PostgreSQL Connection', passed: true, message: 'Connected successfully' });
      printCheck('Connection', true);

      // Query test
      const versionResult = await client.query('SELECT version();');
      const version = (versionResult.rows[0].version as string).substring(0, 60) + '...';
      checks.push({ name: 'PostgreSQL Query', passed: true, message: version });
      printCheck('Query (SELECT)', true, verbose ? version : undefined);

      // Permission tests - CREATE TABLE
      const testTable = '_validate_infra_test';
      try {
        await client.query(`DROP TABLE IF EXISTS ${testTable};`);
        await client.query(`CREATE TABLE ${testTable} (id SERIAL PRIMARY KEY, val TEXT);`);
        checks.push({ name: 'PostgreSQL CREATE', passed: true, message: `Created table ${testTable}` });
        printCheck('CREATE TABLE', true);

        // INSERT
        await client.query(`INSERT INTO ${testTable} (val) VALUES ('test');`);
        checks.push({ name: 'PostgreSQL INSERT', passed: true, message: 'Inserted test row' });
        printCheck('INSERT', true);

        // SELECT
        await client.query(`SELECT * FROM ${testTable};`);
        checks.push({ name: 'PostgreSQL SELECT', passed: true, message: 'Selected from test table' });
        printCheck('SELECT', true);

        // UPDATE
        await client.query(`UPDATE ${testTable} SET val = 'updated' WHERE id = 1;`);
        checks.push({ name: 'PostgreSQL UPDATE', passed: true, message: 'Updated test row' });
        printCheck('UPDATE', true);

        // DELETE
        await client.query(`DELETE FROM ${testTable} WHERE id = 1;`);
        checks.push({ name: 'PostgreSQL DELETE', passed: true, message: 'Deleted test row' });
        printCheck('DELETE', true);

        // Cleanup
        await client.query(`DROP TABLE ${testTable};`);
        printCheck('Cleanup', true, 'Dropped test table');
      } catch (err) {
        const error = err as Error;
        checks.push({ name: 'PostgreSQL Permissions', passed: false, message: error.message });
        printCheck('Permissions', false, error.message);
      }

      await client.end();
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message.trim();
      checks.push({ name: 'PostgreSQL Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      // Provide actionable hints
      if (errorMsg.includes('no pg_hba.conf entry') || errorMsg.toLowerCase().includes('not allowed')) {
        printWarning('Check trusted sources - your IP may not be whitelisted');
      } else if (errorMsg.toLowerCase().includes('connection refused')) {
        printWarning('Database may be down or firewall blocking access');
      } else if (errorMsg.toLowerCase().includes('password authentication failed')) {
        printWarning('Check username/password credentials');
      }
    }
  } catch (err) {
    checks.push({ name: 'PostgreSQL Driver', passed: false, message: 'pg not installed' });
    printCheck('Driver (pg)', false, 'npm install pg');
  }

  return checks;
}

/**
 * Validate MySQL connectivity and permissions.
 */
async function validateMysql(url: string, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const parsed = parseUrl(url);

  printInfo(`Host: ${parsed.host}:${parsed.port}`);
  printInfo(`Database: ${parsed.database}`);
  printInfo(`User: ${parsed.username}`);
  printInfo(`Password: ${maskSecret(parsed.password)}`);

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(parsed.host, parsed.port!);
  checks.push({ name: 'MySQL TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    return checks;
  }

  try {
    const mysql = await import('mysql2/promise');

    // Determine SSL settings
    const sslMode = parsed.params['ssl-mode'] || parsed.params['sslmode'];
    const ssl =
      sslMode && ['REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY', 'require'].includes(sslMode.toUpperCase())
        ? { rejectUnauthorized: false }
        : undefined;

    try {
      const connection = await mysql.createConnection({
        host: parsed.host,
        port: parsed.port!,
        user: parsed.username,
        password: parsed.password,
        database: parsed.database,
        ssl,
        connectTimeout: 10000,
      });

      checks.push({ name: 'MySQL Connection', passed: true, message: 'Connected successfully' });
      printCheck('Connection', true);

      // Query test
      const [rows] = await connection.query('SELECT VERSION() as version;');
      const version = (rows as any)[0].version;
      checks.push({ name: 'MySQL Query', passed: true, message: `Version: ${version}` });
      printCheck('Query (SELECT)', true, verbose ? `Version: ${version}` : undefined);

      // Permission tests
      const testTable = '_validate_infra_test';
      try {
        await connection.query(`DROP TABLE IF EXISTS ${testTable};`);
        await connection.query(
          `CREATE TABLE ${testTable} (id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255));`
        );
        checks.push({ name: 'MySQL CREATE', passed: true, message: `Created table ${testTable}` });
        printCheck('CREATE TABLE', true);

        await connection.query(`INSERT INTO ${testTable} (val) VALUES ('test');`);
        checks.push({ name: 'MySQL INSERT', passed: true, message: 'Inserted test row' });
        printCheck('INSERT', true);

        await connection.query(`SELECT * FROM ${testTable};`);
        checks.push({ name: 'MySQL SELECT', passed: true, message: 'Selected from test table' });
        printCheck('SELECT', true);

        await connection.query(`UPDATE ${testTable} SET val = 'updated' WHERE id = 1;`);
        checks.push({ name: 'MySQL UPDATE', passed: true, message: 'Updated test row' });
        printCheck('UPDATE', true);

        await connection.query(`DELETE FROM ${testTable} WHERE id = 1;`);
        checks.push({ name: 'MySQL DELETE', passed: true, message: 'Deleted test row' });
        printCheck('DELETE', true);

        // Cleanup
        await connection.query(`DROP TABLE ${testTable};`);
        printCheck('Cleanup', true, 'Dropped test table');
      } catch (err) {
        const error = err as Error;
        checks.push({ name: 'MySQL Permissions', passed: false, message: error.message });
        printCheck('Permissions', false, error.message);
      }

      await connection.end();
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      checks.push({ name: 'MySQL Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      if (errorMsg.includes('Access denied')) {
        printWarning('Check username/password or trusted sources');
      } else if (errorMsg.includes("Can't connect")) {
        printWarning('Database may be down or firewall blocking access');
      }
    }
  } catch {
    checks.push({ name: 'MySQL Driver', passed: false, message: 'mysql2 not installed' });
    printCheck('Driver (mysql2)', false, 'npm install mysql2');
  }

  return checks;
}

/**
 * Validate MongoDB connectivity.
 */
async function validateMongodb(url: string, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const parsed = parseUrl(url);

  printInfo(`Host: ${parsed.host}`);
  printInfo(`Database: ${parsed.database}`);
  printInfo(`User: ${parsed.username}`);
  printInfo(`Password: ${maskSecret(parsed.password)}`);

  // TCP check (skip for SRV records)
  if (parsed.scheme !== 'mongodb+srv') {
    const [tcpSuccess, tcpMsg] = await tcpCheck(parsed.host, parsed.port!);
    checks.push({ name: 'MongoDB TCP', passed: tcpSuccess, message: tcpMsg });
    printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

    if (!tcpSuccess) {
      return checks;
    }
  }

  try {
    const { MongoClient } = await import('mongodb');

    try {
      const client = new MongoClient(url, { serverSelectionTimeoutMS: 10000 });
      await client.connect();

      // Ping test
      await client.db('admin').command({ ping: 1 });
      checks.push({ name: 'MongoDB Connection', passed: true, message: 'Connected successfully' });
      printCheck('Connection', true);

      // Server info
      try {
        const info = await client.db('admin').command({ serverStatus: 1 });
        const version = info.version || 'unknown';
        checks.push({ name: 'MongoDB Server', passed: true, message: `Version: ${version}` });
        printCheck('Server Info', true, verbose ? `Version: ${version}` : undefined);
      } catch {
        // serverStatus might require admin privileges, try buildInfo instead
        try {
          const info = await client.db('admin').command({ buildInfo: 1 });
          const version = info.version || 'unknown';
          checks.push({ name: 'MongoDB Server', passed: true, message: `Version: ${version}` });
          printCheck('Server Info', true, verbose ? `Version: ${version}` : undefined);
        } catch {
          // Ignore - server info is optional
        }
      }

      // Database access test
      const dbName = parsed.database || 'admin';
      const db = client.db(dbName);

      const testCollection = '_validate_infra_test';
      try {
        const collection = db.collection(testCollection);

        // Insert
        const insertResult = await collection.insertOne({ test: 'value' });
        checks.push({ name: 'MongoDB INSERT', passed: true, message: 'Inserted document' });
        printCheck('INSERT', true);

        // Find
        const doc = await collection.findOne({ _id: insertResult.insertedId });
        if (doc) {
          checks.push({ name: 'MongoDB FIND', passed: true, message: 'Found document' });
          printCheck('FIND', true);
        }

        // Update
        await collection.updateOne({ _id: insertResult.insertedId }, { $set: { test: 'updated' } });
        checks.push({ name: 'MongoDB UPDATE', passed: true, message: 'Updated document' });
        printCheck('UPDATE', true);

        // Delete
        await collection.deleteOne({ _id: insertResult.insertedId });
        checks.push({ name: 'MongoDB DELETE', passed: true, message: 'Deleted document' });
        printCheck('DELETE', true);

        // Cleanup - drop collection
        await db.dropCollection(testCollection);
        printCheck('Cleanup', true, 'Dropped test collection');
      } catch (err) {
        const error = err as Error;
        checks.push({ name: 'MongoDB Operations', passed: false, message: error.message });
        printCheck('Operations', false, error.message);
      }

      await client.close();
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      checks.push({ name: 'MongoDB Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      if (errorMsg.includes('Authentication failed')) {
        printWarning('Check username/password credentials');
      } else if (errorMsg.toLowerCase().includes('timed out')) {
        printWarning('Check network/firewall or trusted sources');
      }
    }
  } catch {
    checks.push({ name: 'MongoDB Driver', passed: false, message: 'mongodb not installed' });
    printCheck('Driver (mongodb)', false, 'npm install mongodb');
  }

  return checks;
}

/**
 * Detect database type from URL scheme.
 */
function detectDatabaseType(url: string): string | null {
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql';
  } else if (url.startsWith('mysql://')) {
    return 'mysql';
  } else if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
    return 'mongodb';
  }
  return null;
}

/**
 * Run database validation checks.
 */
export async function runChecks(dbType?: string, verbose: boolean = false): Promise<number> {
  printHeader('Database Connectivity Validation');

  const allChecks: CheckResult[] = [];

  // Environment variable mappings
  const dbConfigs: Record<string, [string, string][]> = {
    postgresql: [
      ['DATABASE_URL', 'DATABASE_PRIVATE_URL'],
      ['POSTGRES_URL', 'POSTGRES_PRIVATE_URL'],
      ['PG_URL', 'PG_PRIVATE_URL'],
    ],
    mysql: [
      ['MYSQL_URL', 'MYSQL_PRIVATE_URL'],
      ['MYSQL_DATABASE_URL', 'MYSQL_DATABASE_PRIVATE_URL'],
    ],
    mongodb: [
      ['MONGODB_URI', 'MONGODB_PRIVATE_URI'],
      ['MONGODB_URL', 'MONGODB_PRIVATE_URL'],
      ['MONGO_URL', 'MONGO_PRIVATE_URL'],
    ],
  };

  // Show VPC status
  if (hasVpcInterface()) {
    printInfo('VPC detected - will prefer private URLs');
  } else {
    printInfo('No VPC - using public URLs');
  }
  console.log();

  // Determine which databases to check
  const typesToCheck = dbType ? [dbType] : ['postgresql', 'mysql', 'mongodb'];

  for (const dtype of typesToCheck) {
    if (!(dtype in dbConfigs)) {
      continue;
    }

    for (const [urlKey, privateKey] of dbConfigs[dtype]) {
      const url = getConnectionUrl(urlKey, privateKey);
      if (url) {
        const detected = detectDatabaseType(url);
        if (detected === dtype || detected === null) {
          printInfo(`Found ${dtype.toUpperCase()} URL in ${urlKey}`);
          console.log();

          let checks: CheckResult[];
          if (dtype === 'postgresql') {
            checks = await validatePostgresql(url, verbose);
          } else if (dtype === 'mysql') {
            checks = await validateMysql(url, verbose);
          } else if (dtype === 'mongodb') {
            checks = await validateMongodb(url, verbose);
          } else {
            continue;
          }

          allChecks.push(...checks);
          console.log();
          break;
        }
      }
    }
  }

  if (allChecks.length === 0) {
    printInfo('No database URLs found - skipping database checks');
    printInfo('To enable, set one of these environment variables:');
    for (const dtype of Object.keys(dbConfigs)) {
      for (const [urlKey] of dbConfigs[dtype]) {
        printInfo(`  - ${urlKey}`);
      }
    }
    return 0; // Skip gracefully when not configured
  }

  return printSummary(allChecks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  let dbType: string | undefined;

  for (const arg of process.argv.slice(2)) {
    if (['postgresql', 'mysql', 'mongodb', 'pg', 'postgres', 'mongo'].includes(arg)) {
      if (arg === 'pg' || arg === 'postgres') {
        dbType = 'postgresql';
      } else if (arg === 'mongo') {
        dbType = 'mongodb';
      } else {
        dbType = arg;
      }
      break;
    }
  }

  runChecks(dbType, verbose).then((code) => process.exit(code));
}
