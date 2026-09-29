import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

// Writing the MTG card tables straight to SQLite, for the Scryfall sync.
// app/utils/scryfall.server.ts loads this module only when it runs, so
// nothing that renders a page pulls in node:sqlite.
//
// 100k+ printings go through one short prepared statement each, in batches,
// on a connection of our own. Through Prisma that would be 100k+ round trips
// (or huge multi-row statements, which the query logger in db.server.ts
// would print in full). Rows whose values haven't changed aren't rewritten,
// so a sync after a quiet day touches few pages (LiteFS replicates every
// page written).

export type Row = Record<string, SQLInputValue | Date | boolean>

function openDatabase() {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error('DATABASE_URL is not set')
	const db = new DatabaseSync(url.replace(/^file:/, '').replace(/\?.*$/, ''))
	db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;')
	return db
}

function toSqlValue(value: Row[string] | undefined): SQLInputValue {
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'boolean') return value ? 1 : 0
	return value ?? null
}

/**
 * INSERT ... ON CONFLICT(id) DO UPDATE, only when some column differs, and
 * bumping updatedAt when it does. Column names come from our own row
 * mappers, never from input.
 */
function prepareUpsert(
	db: DatabaseSync,
	table: string,
	columns: Array<string>,
) {
	const quoted = columns.map((c) => `"${c}"`)
	const others = columns.filter((c) => c !== 'id').map((c) => `"${c}"`)
	const statement = db.prepare(
		`INSERT INTO "${table}" (${quoted.join(', ')}, "updatedAt")
		VALUES (${columns.map(() => '?').join(', ')}, ?)
		ON CONFLICT ("id") DO UPDATE SET
			${others.map((c) => `${c} = excluded.${c}`).join(', ')},
			"updatedAt" = excluded."updatedAt"
		WHERE ${others.map((c) => `"${table}".${c} IS NOT excluded.${c}`).join(' OR ')}`,
	)
	return (row: Row, now: number) =>
		Number(
			statement.run(...columns.map((c) => toSqlValue(row[c])), now).changes,
		)
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
	db.exec('BEGIN IMMEDIATE')
	try {
		const result = work()
		db.exec('COMMIT')
		return result
	} catch (error) {
		db.exec('ROLLBACK')
		throw error
	}
}

function createWriter(db: DatabaseSync) {
	const upserts = new Map<string, ReturnType<typeof prepareUpsert>>()
	function upsert(table: string, rows: Array<Row>) {
		if (!rows.length) return 0
		const key = `${table}:${Object.keys(rows[0]!).join(',')}`
		let run = upserts.get(key)
		if (!run) {
			run = prepareUpsert(db, table, Object.keys(rows[0]!))
			upserts.set(key, run)
		}
		const now = Date.now()
		let written = 0
		for (const row of rows) written += run(row, now)
		return written
	}
	return {
		/** Sets, then cards, then printings, in one transaction. */
		write({
			sets = [],
			cards = [],
			printings = [],
		}: {
			sets?: Array<Row>
			cards?: Array<Row>
			printings?: Array<Row>
		}) {
			return inTransaction(db, () => ({
				sets: upsert('MtgSet', sets),
				cards: upsert('MtgCard', cards),
				printings: upsert('MtgPrinting', printings),
			}))
		},
	}
}

/**
 * Delete rows by id, keeping (and counting) any a user's data still refers
 * to: a foreign key makes their DELETE fail, and SQLite rolls back just that
 * statement.
 */
function deleteUnlessReferenced(
	db: DatabaseSync,
	table: string,
	ids: Array<string>,
) {
	const statement = db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`)
	let deleted = 0
	const kept: Array<string> = []
	for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
		inTransaction(db, () => {
			for (const id of ids.slice(i, i + DELETE_BATCH_SIZE)) {
				try {
					deleted += Number(statement.run(id).changes)
				} catch (error) {
					if (!isForeignKeyError(error)) throw error
					kept.push(id)
				}
			}
		})
	}
	return { deleted, kept }
}

function isForeignKeyError(error: unknown) {
	return error instanceof Error && /FOREIGN KEY constraint/i.test(error.message)
}

const DELETE_BATCH_SIZE = 500

export type MtgCardDb = ReturnType<typeof openMtgCardDb>

/** A connection of our own to the app database, for one sync. */
export function openMtgCardDb() {
	const db = openDatabase()
	const writer = createWriter(db)
	return {
		write: (batch: Parameters<typeof writer.write>[0]) => writer.write(batch),
		/** Ids of printings in the table but not in `seen`. */
		printingIdsNotIn(seen: Set<string>) {
			return (
				db.prepare('SELECT "id" FROM "MtgPrinting"').all() as Array<{
					id: string
				}>
			)
				.map((row) => row.id)
				.filter((id) => !seen.has(id))
		},
		/** Ids of cards no printing refers to. */
		orphanCardIds() {
			return (
				db
					.prepare(
						'SELECT "id" FROM "MtgCard" WHERE "id" NOT IN (SELECT "cardId" FROM "MtgPrinting")',
					)
					.all() as Array<{ id: string }>
			).map((row) => row.id)
		},
		deleteUnlessReferenced(
			table: 'MtgPrinting' | 'MtgCard',
			ids: Array<string>,
		) {
			return deleteUnlessReferenced(db, table, ids)
		},
		close() {
			db.close()
		},
	}
}
