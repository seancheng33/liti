import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('category')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('parent_id', 'integer')
    .addColumn('sort', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('question')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('type', 'varchar(16)', (col) => col.notNull())
    .addColumn('stem', 'text', (col) => col.notNull())
    .addColumn('explanation', 'text')
    .addColumn('category_id', 'integer')
    .addColumn('difficulty', 'integer', (col) => col.notNull().defaultTo(2))
    .addColumn('tags', 'text')
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('active'))
    .addColumn('content_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('question_option')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('question_id', 'integer', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('is_correct', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('import_batch')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('filename', 'varchar(255)', (col) => col.notNull())
    .addColumn('total', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('success', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('failed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('errors', 'text')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('import_batch').execute();
  await db.schema.dropTable('question_option').execute();
  await db.schema.dropTable('question').execute();
  await db.schema.dropTable('category').execute();
}
