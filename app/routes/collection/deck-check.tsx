import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { data, Form } from 'react-router'
import { toast } from 'sonner'
import { CountBadge } from '#app/components/card-art.tsx'
import { CollectionNav } from '#app/components/collection-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { FactionDot } from '#app/components/printing-tile.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	checkDeckAgainstCollection,
	DeckImportError,
	fetchNrdbDeck,
	parseDeckText,
	parseNrdbDeckRef,
} from '#app/utils/deck-check.server.ts'
import { cn, useIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/deck-check.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

const MAX_INPUT_LENGTH = 20_000

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	return null
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const deck = formData.get('deck')
	const input = (typeof deck === 'string' ? deck : '').slice(
		0,
		MAX_INPUT_LENGTH,
	)
	if (!input.trim()) {
		return data(
			{ input, error: 'Paste a decklist or NetrunnerDB link first.' },
			{ status: 400 },
		)
	}

	try {
		const ref = parseNrdbDeckRef(input)
		const requirements = ref
			? await fetchNrdbDeck(ref)
			: await parseDeckText(input)
		if (requirements.cards.size === 0) {
			return data(
				{
					input,
					error:
						'Couldn\'t find any cards in that. Use one card per line, like "3x Hedge Fund".',
				},
				{ status: 400 },
			)
		}
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

const PLACEHOLDER = `Paste a NetrunnerDB deck link, e.g.
https://netrunnerdb.com/en/decklist/…

or a decklist, one card per line:
René "Loup" Arcemont: Party Animal
3x Wildcat Strike
2 Carnivore
Mayday x1`

export default function DeckCheckRoute({ actionData }: Route.ComponentProps) {
	const isPending = useIsPending()
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
			</header>

			<Form method="POST" className="flex flex-col gap-2">
				<Label htmlFor="deck">Deck</Label>
				<Textarea
					id="deck"
					name="deck"
					rows={8}
					required
					maxLength={MAX_INPUT_LENGTH}
					placeholder={PLACEHOLDER}
					defaultValue={actionData?.input ?? ''}
					className="font-mono text-sm"
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? 'deck-error' : undefined}
				/>
				{error ? (
					<p id="deck-error" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<StatusButton
					type="submit"
					status={isPending ? 'pending' : 'idle'}
					className="self-start"
				>
					Check deck
				</StatusButton>
			</Form>

			{result ? <DeckResult result={result} /> : null}
		</main>
	)
}

type Result = Awaited<ReturnType<typeof checkDeckAgainstCollection>>

function DeckResult({ result }: { result: Result }) {
	const complete = result.missingCards === 0
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
							: `You're missing ${result.missingCards} of ${result.totalCards} cards (${result.missingUnique} different).`}
					</p>
				</div>
				{complete ? null : <CopyMissingButton rows={result.rows} />}
			</div>

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
							<img
								src={row.imageSmall}
								alt=""
								loading="lazy"
								width={40}
								height={56}
								className={cn(
									'h-14 w-10 shrink-0 rounded object-cover',
									row.owned === 0 && 'opacity-60 grayscale',
								)}
							/>
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
						{row.missing > 0 ? (
							<span className="text-sm font-semibold whitespace-nowrap text-amber-700 dark:text-amber-300">
								need {row.missing}
							</span>
						) : null}
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
