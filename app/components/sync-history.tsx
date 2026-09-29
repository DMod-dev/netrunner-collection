import { useEffect } from 'react'
import { useRevalidator } from 'react-router'
import { cn } from '#app/utils/misc.tsx'

const TRIGGER_LABELS: Record<string, string> = {
	schedule: 'Scheduled',
	manual: 'Manual',
	cli: 'Command line',
}

export const syncDateFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

/** While a sync runs, revalidate every few seconds so the page updates. */
export function useSyncPolling(running: boolean) {
	const revalidator = useRevalidator()
	useEffect(() => {
		if (!running) return
		const interval = setInterval(() => {
			if (revalidator.state === 'idle') void revalidator.revalidate()
		}, 3000)
		return () => clearInterval(interval)
	}, [running, revalidator])
}

export type SyncHistoryRow = {
	id: string
	startedAt: Date | string
	trigger: string
	status: string
	error: string | null
	/** what a successful run did, e.g. "3,000 cards ... in 12.3s" */
	details: string | null
}

/** The recent runs of a card data sync (NrdbSync, MtgSync). */
export function SyncHistory({ history }: { history: Array<SyncHistoryRow> }) {
	return (
		<section aria-labelledby="history" className="flex flex-col gap-2">
			<h2 id="history" className="text-lg font-bold">
				Recent syncs
			</h2>
			{history.length === 0 ? (
				<p className="text-muted-foreground">No syncs yet.</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="text-muted-foreground border-b text-xs">
							<tr>
								<th className="py-2 pr-4 font-medium">Started</th>
								<th className="py-2 pr-4 font-medium">Trigger</th>
								<th className="py-2 pr-4 font-medium">Status</th>
								<th className="py-2 font-medium">Details</th>
							</tr>
						</thead>
						<tbody className="divide-border divide-y">
							{history.map((sync) => (
								<tr key={sync.id}>
									<td className="py-2 pr-4 whitespace-nowrap">
										{syncDateFormat.format(new Date(sync.startedAt))}
									</td>
									<td className="py-2 pr-4">
										{TRIGGER_LABELS[sync.trigger] ?? sync.trigger}
									</td>
									<td className="py-2 pr-4">
										<span
											className={cn(
												'rounded-full px-2 py-0.5 text-xs font-semibold',
												sync.status === 'success' &&
													'bg-green-600/15 text-green-800 dark:text-green-300',
												sync.status === 'error' &&
													'bg-destructive/15 text-destructive',
												sync.status === 'running' &&
													'bg-secondary text-secondary-foreground',
											)}
										>
											{sync.status}
										</span>
									</td>
									<td className="text-muted-foreground max-w-md py-2">
										{sync.details ? (
											sync.details
										) : sync.error ? (
											<details>
												<summary className="line-clamp-2 cursor-pointer">
													{sync.error.trim().split('\n').at(-1)}
												</summary>
												<pre className="mt-1 max-h-60 overflow-auto text-xs whitespace-pre-wrap">
													{sync.error}
												</pre>
											</details>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

/** The row of counts at the top of a sync page. */
export function SyncCounts({ counts }: { counts: Record<string, number> }) {
	return (
		<dl className="grid grid-cols-3 gap-3 sm:max-w-2xl sm:grid-cols-5">
			{Object.entries(counts).map(([label, value]) => (
				<div key={label} className="bg-muted rounded-lg p-3">
					<dt className="text-muted-foreground text-xs capitalize">{label}</dt>
					<dd className="text-xl font-bold tabular-nums">
						{value.toLocaleString()}
					</dd>
				</div>
			))}
		</dl>
	)
}
