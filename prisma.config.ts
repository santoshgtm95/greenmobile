import { defineConfig } from 'prisma/config';

/**
 * Build-time only.
 *
 * Prisma is used in this project purely as the schema source of truth and DDL
 * generator (`npm run schema:sql`). The URL below points at a throwaway local
 * file that exists solely so the migration engine has a shape to diff against —
 * the shipped application never reads it, and no Prisma engine is packaged.
 *
 * The real database lives at %APPDATA%\MobileShopPOS\data\pos.db and is opened
 * by electron/database/connection.ts through better-sqlite3.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: 'file:./prisma/dev.db',
  },
});
