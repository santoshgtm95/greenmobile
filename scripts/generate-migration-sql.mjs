/**
 * Regenerates prisma/migrations/0001_initial/migration.sql from
 * prisma/schema.prisma using Prisma's own migration engine.
 *
 *     npm run schema:sql
 *
 * Prisma is a build-time tool here: it owns the schema definition and emits the
 * DDL. At runtime the application applies these .sql files itself through
 * better-sqlite3 (electron/database/migrator.ts), so the packaged app ships no
 * Prisma engine and needs no Node CLI.
 *
 * Changing the schema later means adding a NEW numbered migration containing
 * only the delta — never editing an applied one. Generate a delta with:
 *
 *   npx prisma migrate diff \
 *     --from-local-d1 <old>  (or --from-schema-datamodel prisma/schema.previous.prisma) \
 *     --to-schema-datamodel prisma/schema.prisma --script
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'prisma/migrations');
const outDir = path.join(migrationsDir, '0001_initial');
const outFile = path.join(outDir, 'migration.sql');

/**
 * Once a second migration exists, 0001 is history and must not be rewritten.
 *
 * Regenerating it from the current schema would put the later tables in BOTH
 * files: a fresh install would create them in 0001 and then fail in 0002, while
 * a shop already at user_version 1 would never get them at all. The failure
 * would surface as a broken installer long after this command was run, so it is
 * refused here instead.
 */
const later = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(\d+)_/.test(entry.name))
      .filter((entry) => Number(/^(\d+)_/.exec(entry.name)[1]) > 1)
      .map((entry) => entry.name)
      .sort()
  : [];

if (later.length > 0) {
  console.error(
    `[schema:sql] refusing to rewrite 0001_initial — later migrations exist: ${later.join(', ')}`,
  );
  console.error('[schema:sql] add a NEW numbered migration with only the delta instead:');
  console.error('[schema:sql]   node node_modules/prisma/build/index.js migrate diff \\');
  console.error('[schema:sql]     --from-empty --to-schema prisma/schema.prisma --script');
  console.error('[schema:sql]   ...then keep only the CREATE statements for the new tables.');
  process.exit(1);
}

// Invoke the Prisma CLI entry point with the current node binary, rather than
// going through npx/.cmd shims which do not spawn reliably on Windows.
const prismaCli = path.join(root, 'node_modules/prisma/build/index.js');

const sql = execFileSync(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);

if (!/CREATE TABLE/i.test(sql)) {
  console.error('[schema:sql] prisma produced no DDL — aborting so a good file is not overwritten');
  console.error(sql);
  process.exit(1);
}

const header = [
  '-- Generated from prisma/schema.prisma by `npm run schema:sql`.',
  '-- Do not edit by hand: change the Prisma schema and regenerate.',
  '-- Applied at runtime by electron/database/migrator.ts.',
  '',
].join('\n');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, header + sql, 'utf8');

const tables = (sql.match(/CREATE TABLE/gi) ?? []).length;
const indexes = (sql.match(/CREATE (UNIQUE )?INDEX/gi) ?? []).length;
console.log(`[schema:sql] wrote ${path.relative(root, outFile)} — ${tables} tables, ${indexes} indexes`);
