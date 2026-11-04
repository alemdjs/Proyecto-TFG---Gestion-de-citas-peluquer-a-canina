import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://peluqueria:peluqueria@localhost:5433/peluqueria";

const pool = new Pool({ connectionString });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migraciones aplicadas correctamente");
await pool.end();
