/**
 * The run/log layer shared by the card data syncs (NetrunnerDB and Scryfall):
 * one sync at a time per source, each run recorded in that source's log table,
 * runs left "running" by a restart cleared after a while, and a check that
 * starts a sync when the last successful one is old enough.
 */

export type SyncTrigger = 'schedule' | 'manual' | 'cli'

/** How a source records its runs (NrdbSync, MtgSync). */
export type SyncRecordStore<Summary> = {
	start(trigger: SyncTrigger): Promise<{ id: string }>
	succeed(id: string, summary: Summary): Promise<unknown>
	fail(id: string, error: string): Promise<unknown>
	/** Mark "running" rows started before `startedBefore` as interrupted. */
	interruptStale(startedBefore: Date): Promise<unknown>
	countRunning(): Promise<number>
	lastSuccessStartedAt(): Promise<Date | null>
}

export const INTERRUPTED_ERROR = 'Interrupted before it finished'

export function createSyncRunner<Options extends object, Summary>({
	label,
	store,
	sync,
	everyMs,
	staleAfterMs,
}: {
	/** For log messages: "NRDB", "Scryfall" */
	label: string
	store: SyncRecordStore<Summary>
	sync: (options?: Options) => Promise<Summary>
	/** How old the last successful sync must be before syncIfDue starts one. */
	everyMs: number
	/** A sync still "running" after this long was interrupted (e.g. a restart). */
	staleAfterMs: number
}) {
	// guards against two syncs in this process; the "running" row covers restarts
	let syncInProgress = false

	async function isSyncRunningInDb() {
		await store.interruptStale(new Date(Date.now() - staleAfterMs))
		return (await store.countRunning()) > 0
	}

	/**
	 * Whether a sync is currently running. Rows left "running" by a process
	 * that died mid-sync are marked as interrupted so they don't block future
	 * syncs.
	 */
	async function isSyncRunning() {
		return syncInProgress || (await isSyncRunningInDb())
	}

	/** Run a sync and record the outcome in the log table. */
	async function runRecordedSync({
		trigger = 'cli',
		...options
	}: Partial<Options> & { trigger?: SyncTrigger } = {}) {
		syncInProgress = true
		try {
			const record = await store.start(trigger)
			try {
				const summary = await sync(options as Options)
				await store.succeed(record.id, summary)
				return summary
			} catch (error) {
				await store.fail(
					record.id,
					error instanceof Error ? error.message : String(error),
				)
				throw error
			}
		} finally {
			syncInProgress = false
		}
	}

	/**
	 * Start a sync without waiting for it. Returns false if one is already
	 * running.
	 */
	async function startSyncInBackground(
		trigger: SyncTrigger,
		options: Partial<Options> = {},
	) {
		// claim the flag before awaiting anything, so two requests arriving
		// together can't both start a sync
		if (syncInProgress) return false
		syncInProgress = true
		let runningElsewhere: boolean
		try {
			runningElsewhere = await isSyncRunningInDb()
		} catch (error) {
			syncInProgress = false
			throw error
		}
		if (runningElsewhere) {
			syncInProgress = false
			return false
		}
		runRecordedSync({ ...options, trigger }).catch((error: unknown) => {
			console.error(`${label} sync failed`, error)
		})
		return true
	}

	/** Sync if the last successful sync is older than `everyMs`. */
	async function syncIfDue({ now = Date.now() } = {}) {
		const last = await store.lastSuccessStartedAt()
		if (last && now - last.getTime() < everyMs) return false
		return startSyncInBackground('schedule')
	}

	return { isSyncRunning, runRecordedSync, startSyncInBackground, syncIfDue }
}

/**
 * Automatic syncing is on unless its env flag is "false", and never in tests
 * or with mocks (dev and e2e runs; sync those by hand from the command line).
 */
export function isAutoSyncFlagOn(flag: string | undefined) {
	return (
		flag !== 'false' &&
		process.env.NODE_ENV !== 'test' &&
		process.env.MOCKS !== 'true'
	)
}
