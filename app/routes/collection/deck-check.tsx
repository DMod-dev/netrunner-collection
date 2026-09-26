import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useId, useState } from 'react'
import { data, Form } from 'react-router'
import { toast } from 'sonner'
import {
	CountBadge,
	washedOut,
	washedOutBackdrop,
} from '#app/components/card-art.tsx'
import { CollectionNav } from '#app/components/collection-ui.tsx'
import { DeckInputField } from '#app/components/deck-input.tsx'
import { FillStatusBadge } from '#app/components/deck-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireCollectionAccess } from '#app/utils/collection-access.server.ts'
import {
	checkDeckAgainstCollection,
	DeckImportError,
} from '#app/utils/deck-check.server.ts'
import { DECK_FORMAT_NAMES, DECK_FORMATS } from '#app/utils/deck-formats.ts'
import { readDeckInput } from '#app/utils/deck-import.server.ts'
import { MAX_DECK_INPUT_LENGTH } from '#app/utils/deck-import.ts'
import { cn, useIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/deck-check.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

// Owner-only: deck check isn't mounted under /users/:username/collection.
export async function loader({ request }: Route.LoaderArgs) {
	await requireCollectionAccess(request)
	return null
}

export async function action({ request }: Route.ActionArgs) {
	const { ownerId: userId } = await requireCollectionAccess(request)
	const formData = await request.formData()
	const deck = formData.get('deck')
	const input = (typeof deck === 'string' ? deck : '').slice(
		0,
		MAX_DECK_INPUT_LENGTH,
	)
	try {
		const requirements = await readDeckInput(input)
		const result = await checkDeckAgainstCollection(userId, requirements)
		return { input, result }
	} catch (error) {
		if (error instanceof DeckImportError) {
			return data({ input, error: error.message }, { status: 400 })
		}
		throw error
	}
}

export const meta: Route.MetaFunction = () => [
	{ title: 'Deck check | Netrunner Collection' },
]

export default function DeckCheckRoute({ actionData }: Route.ComponentProps) {
	const id = useId()
	const isPending = useIsPending({ formAction: '/collection/deck-check' })
	const result = actionData && 'result' in actionData ? actionData.result : null
	const error = actionData && 'error' in actionData ? actionData.error : null

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<CollectionNav />
			<header className="flex flex-col gap-1">
				<h1 className="text-h2">Deck check</h1>
				<p className="text-muted-foreground">
					See whether your collection can build a deck, and what you'd need to
					get. Any printing or version of a card counts.
				</p>
				<p className="text-muted-foreground">
					Quick check — nothing is saved. To keep the deck and reserve cards,
					save it as a deck.
				</p>
			</header>

			<Form method="POST" className="flex flex-col gap-2">
				<DeckInputField
					id={`${id}-deck`}
					defaultValue={actionData?.input ?? ''}
					error={error}
				/>
				<StatusButton
					type="submit"
					status={isPending ? 'pending' : 'idle'}
					className="self-start"
				>
					Check deck
				</StatusButton>
			</Form>

			{result && actionData ? (
				<DeckResult result={result} input={actionData.input} />
			) : null}
		</main>
	)
}

type Result = Awaited<ReturnType<typeof checkDeckAgainstCollection>>

function DeckResult({ result, input }: { result: Result; input: string }) {
	const complete = result.missingCards === 0 && result.inUseCards === 0
	return (
		<section aria-labelledby="deck-result" className="flex flex-col gap-4">
			<div
				className={cn(
					'flex flex-wrap items-center justify-between gap-3 rounded-lg p-4',
					complete
						? 'bg-green-600/10 text-green-900 dark:text-green-200'
						: 'bg-amber-500/15 text-amber-950 dark:text-amber-100',
				)}
			>
				<div>
					<h2 id="deck-result" className="text-lg font-bold">
						{result.nrdbUrl ? (
							<a
								href={result.nrdbUrl}
								target="_blank"
								rel="noreferrer"
								className="hover:underline"
							>
								{result.name ?? 'NetrunnerDB deck'}
							</a>
						) : (
							(result.name ?? 'Your deck')
						)}
					</h2>
					<p>
						{complete
							? `You own everything you need for all ${result.totalCards} cards.`
							: result.missingCards > 0
								? `You're missing ${result.missingCards} of ${result.totalCards} cards (${result.missingUnique} different).`
								: `You own all ${result.totalCards} cards.`}
						{result.inUseCards > 0
							? ` ${result.inUseCards} ${result.inUseCards === 1 ? 'copy is' : 'copies are'} in use by your other decks.`
							: null}
					</p>
				</div>
				{result.missingCards > 0 ? (
					<CopyMissingButton rows={result.rows} />
				) : null}
			</div>

			<SaveAsDeckForm input={input} />

			{result.unrecognized.length ? (
				<div className="text-sm">
					<p className="font-semibold">
						Couldn't match {result.unrecognized.length}{' '}
						{result.unrecognized.length === 1 ? 'line' : 'lines'}:
					</p>
					<ul className="text-muted-foreground list-inside list-disc font-mono">
						{result.unrecognized.map((line, i) => (
							<li key={i}>{line}</li>
						))}
					</ul>
				</div>
			) : null}

			<ul className="border-border divide-border divide-y rounded-lg border">
				{result.rows.map((row) => (
					<li
						key={row.id}
						className={cn(
							'flex items-center gap-3 px-3 py-2',
							row.missing > 0 && 'bg-amber-500/5',
						)}
					>
						{row.imageSmall ? (
							<span
								className={cn(
									'shrink-0 rounded',
									row.owned === 0 && washedOutBackdrop,
								)}
							>
								<img
									src={row.imageSmall}
									alt=""
									loading="lazy"
									width={40}
									height={56}
									className={cn(
										'h-14 w-10 rounded object-cover',
										row.owned === 0 && washedOut,
									)}
								/>
							</span>
						) : null}
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="leading-tight font-semibold">
								<FactionDot factionId={row.factionId} /> {row.title}
							</span>
							<span className="text-muted-foreground line-clamp-2 text-xs">
								{row.typeName}
								{row.sources.length
									? ` · ${row.sources.map((s) => `${s.quantity}× ${s.label}`).join(', ')}`
									: ' · none owned'}
							</span>
						</div>
						{row.status.kind === 'ok' ? null : (
							<span className="flex max-w-[50%] flex-wrap justify-end gap-1">
								<FillStatusBadge
									status={row.status}
									reservedBy={row.reservedBy}
								/>
							</span>
						)}
						<CountBadge
							owned={row.owned}
							target={row.need}
							title={`You own ${row.owned}; the deck uses ${row.need}`}
						/>
					</li>
				))}
			</ul>
		</section>
	)
}

/**
 * Import the same pasted text as a new deck, filled from the collection;
 * the import tab on /decks/new does the rest.
 */
function SaveAsDeckForm({ input }: { input: string }) {
	const id = useId()
	const isPending = useIsPending({ formAction: '/decks/new?mode=import' })
	return (
		<Form
			method="POST"
			action="/decks/new?mode=import"
			className="flex flex-wrap items-end gap-3"
		>
			<input type="hidden" name="intent" value="import" />
			<input type="hidden" name="deck" value={input} />
			<div className="flex flex-col gap-1">
				<Label
					htmlFor={`${id}-format`}
					className="text-muted-foreground text-xs"
				>
					Format
				</Label>
				<NativeSelect id={`${id}-format`} name="formatId">
					{DECK_FORMATS.map((f) => (
						<NativeSelectOption key={f} value={f}>
							{DECK_FORMAT_NAMES[f]}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			<StatusButton
				type="submit"
				variant="outline"
				status={isPending ? 'pending' : 'idle'}
				disabled={isPending}
			>
				Save as deck
			</StatusButton>
		</Form>
	)
}

function CopyMissingButton({ rows }: { rows: Result['rows'] }) {
	const [copied, setCopied] = useState(false)
	const text = rows
		.filter((r) => r.missing > 0)
		.map((r) => `${r.missing}x ${r.title}`)
		.join('\n')
	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text)
				} catch {
					toast.error("Couldn't copy to the clipboard")
					return
				}
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			}}
		>
			{copied ? 'Copied!' : 'Copy missing list'}
		</Button>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
