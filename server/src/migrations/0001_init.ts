import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('user')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('username', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('display_name', 'varchar(128)', (col) => col.notNull())
    .addColumn('password_hash', 'varchar(255)')
    .addColumn('role', 'varchar(16)', (col) => col.notNull().defaultTo('student'))
    .addColumn('provider', 'varchar(16)', (col) => col.notNull().defaultTo('local'))
    .addColumn('external_id', 'varchar(255)')
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .addColumn('updated_at', 'bigint', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('session')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('token_hash', 'varchar(128)', (col) => col.notNull().unique())
    .addColumn('expires_at', 'bigint', (col) => col.notNull())
    .addColumn('ip', 'varchar(64)')
    .addColumn('ua', 'varchar(255)')
    .addColumn('created_at', 'bigint', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('session').execute();
  await db.schema.dropTable('user').execute();
}
