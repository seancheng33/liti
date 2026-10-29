import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('paper')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('title', 'varchar(255)', (c) => c.notNull())
    .addColumn('mode', 'varchar(16)', (c) => c.notNull())
    .addColumn('question_count', 'integer', (c) => c.notNull())
    .addColumn('duration_sec', 'integer', (c) => c.notNull())
    .addColumn('pass_score', 'integer', (c) => c.notNull().defaultTo(60))
    .addColumn('review_mode', 'varchar(16)', (c) => c.notNull().defaultTo('after_submit'))
    .addColumn('shuffle_options', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('random_config', 'text')
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('draft'))
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .addColumn('updated_at', 'bigint', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('paper_item')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('paper_id', 'integer', (c) => c.notNull())
    .addColumn('question_id', 'integer', (c) => c.notNull())
    .addColumn('order_no', 'integer', (c) => c.notNull())
    .addColumn('score', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();

  await db.schema
    .createTable('attempt')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('paper_id', 'integer', (c) => c.notNull())
    .addColumn('user_id', 'integer', (c) => c.notNull())
    .addColumn('started_at', 'bigint', (c) => c.notNull())
    .addColumn('deadline_at', 'bigint', (c) => c.notNull())
    .addColumn('submitted_at', 'bigint')
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('in_progress'))
    .addColumn('score', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total_score', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('correct_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('submit_reason', 'varchar(16)')
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('attempt_item')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('attempt_id', 'integer', (c) => c.notNull())
    .addColumn('question_id', 'integer', (c) => c.notNull())
    .addColumn('order_no', 'integer', (c) => c.notNull())
    .addColumn('option_order', 'text', (c) => c.notNull())
    .addColumn('selected', 'text')
    .addColumn('is_correct', 'integer')
    .addColumn('score', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('answered_at', 'bigint')
    .execute();

  await db.schema
    .createTable('attempt_violation')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('attempt_id', 'integer', (c) => c.notNull())
    .addColumn('type', 'varchar(32)', (c) => c.notNull())
    .addColumn('occurred_at', 'bigint', (c) => c.notNull())
    .addColumn('meta', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('attempt_violation').execute();
  await db.schema.dropTable('attempt_item').execute();
  await db.schema.dropTable('attempt').execute();
  await db.schema.dropTable('paper_item').execute();
  await db.schema.dropTable('paper').execute();
}
