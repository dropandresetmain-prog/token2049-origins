import { Db } from '../src/infrastructure/db.js';
import { loadCoreEnv } from '../src/infrastructure/config.js';

const db = new Db(loadCoreEnv().DATABASE_URL);
try {
  await db.initialize();
  process.stdout.write('PostgreSQL migrations applied\n');
} finally {
  await db.close();
}
