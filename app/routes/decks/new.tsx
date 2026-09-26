import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useId, useState } from 'react'
import { data, Form, Link, redirect, useSearchParams } from 'react-router'
import { z } from 'zod'
import { IdentityArt } from '#app/components/deck-ui.tsx'
import { GeneralErrorBoundary } from '#app/components/error-boundary.tsx'
import { Checkbox } from '#app/components/ui/checkbox.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	NativeSelect,
	NativeSelectOption,
} from '#app/components/ui/native-select.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	DECK_FORMAT_NAMES,
	DECK_FORMATS,
	type DeckFormat,
} from '#app/utils/deck-formats.ts'
import { createDeck, getIdentities } from '#app/utils/deck.server.ts'
import {
	DECK_SIDES,
	MAX_DECK_NAME_LENGTH,
	parseDeckFormat,
	parseDeckSide,
} from '#app/utils/deck.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { cn, pageTitle, useIsPending } from '#app/utils/misc.tsx'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

/**
 * One side's identities (`?side=corp|runner`). The builder's "change
 * identity" dialog loads them from here too.
 */
export async function loader({ request }: Route.LoaderArgs) {
	await requireUserId(request)
	const side = parseDeckSide(
		new URL(request.url).searchParams.get('side') ?? '',
	)
	return { side, identities: await getIdentities(side) }
}

const NewDeckSchema = z.object({
	identityCardId: z.string({ error: 'Pick an identity' }).min(1),
	formatId: z.enum(DECK_FORMATS),
	name: z.string().trim().max(MAX_DECK_NAME_LENGTH).optional(),
})

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	await ensurePrimary()
	const parsed = NewDeckSchema.safeParse(
		Object.fromEntries(await request.formData()),
	)
	if (!parsed.success) {
		return data(
			{ error: parsed.error.issues[0]?.message ?? 'Invalid' },
			{ status: 400 },
		)
	}
	const deck = await createDeck(userId, parsed.data)
	if (!deck) return data({ error: 'Pick an identity' }, { status: 400 })
	throw redirect(`/decks/${deck.id}`)
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('New deck') }]

export default function NewDeckRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { side, identities } = loaderData
	const [searchParams] = useSearchParams()
	const id = useId()
	const isPending = useIsPending()
	const [format, setFormat] = useState<DeckFormat>(() =>
		parseDeckFormat(searchParams.get('format') ?? ''),
	)
	const [query, setQuery] = useState('')
	const [legalOnly, setLegalOnly] = useState(true)
	const [selected, setSelected] = useState<string | null>(null)

	const q = query.trim().toLowerCase()
	const shown = identities.filter(
		(identity) =>
			(!legalOnly || identity.legalFormats.includes(format)) &&
			(!q ||
				identity.title.toLowerCase().includes(q) ||
				identity.factionName.toLowerCase().includes(q)),
	)
	const sideLink = (s: string) => {
		const params = new URLSearchParams(searchParams)
		params.set('side', s)
		params.set('format', format)
		return `?${params}`
	}

	return (
		<main className="container mb-24 flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<Link
					to="/decks"
					className="text-muted-foreground hover:text-foreground self-start text-sm"
				>
					← Decks
				</Link>
				<h1 className="text-h2">New deck</h1>
			</header>

			<Form method="POST" className="flex flex-col gap-4">
				<div className="flex flex-wrap items-end gap-4">
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-xs">Side</span>
						<nav
							aria-label="Side"
							className="bg-muted inline-flex gap-1 rounded-lg p-1"
						>
							{DECK_SIDES.map((s) => (
								<Link
									key={s}
									to={sideLink(s)}
									replace
									preventScrollReset
									aria-current={s === side ? 'page' : undefined}
									onClick={() => setSelected(null)}
									className={cn(
										'rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors',
										s === side
											? 'bg-selected text-selected-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground',
									)}
								>
									{s}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex flex-col gap-1">
						<Label
							htmlFor={`${id}-format`}
							className="text-muted-foreground text-xs"
						>
							Format
						</Label>
						<NativeSelect
							id={`${id}-format`}
							name="formatId"
							value={format}
							onChange={(e) =>
								setFormat(parseDeckFormat(e.currentTarget.value))
							}
						>
							{DECK_FORMATS.map((f) => (
								<NativeSelectOption key={f} value={f}>
									{DECK_FORMAT_NAMES[f]}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="flex min-w-48 flex-1 flex-col gap-1">
						<Label
							htmlFor={`${id}-name`}
							className="text-muted-foreground text-xs"
						>
							Name
						</Label>
						<Input
							id={`${id}-name`}
							name="name"
							maxLength={MAX_DECK_NAME_LENGTH}
							placeholder="Named after the identity if left blank"
							autoComplete="off"
						/>
					</div>
				</div>

				<fieldset className="flex flex-col gap-3">
					<legend className="mb-2 font-semibold">Identity</legend>
					<div className="flex flex-wrap items-center gap-4">
						<Input
							type="search"
							aria-label="Search identities"
							placeholder="Search identities by name or faction"
							value={query}
							onChange={(e) => setQuery(e.currentTarget.value)}
							className="max-w-sm"
						/>
						<div className="flex items-center gap-2">
							<Checkbox
								id={`${id}-legal`}
								checked={legalOnly}
								onCheckedChange={(checked) => setLegalOnly(checked === true)}
							/>
							<Label htmlFor={`${id}-legal`} className="text-sm font-normal">
								Only identities legal in {DECK_FORMAT_NAMES[format]}
							</Label>
						</div>
					</div>
					{shown.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{identities.length === 0
								? 'No identities yet: the card list hasn’t been downloaded from NetrunnerDB.'
								: 'No identities match.'}
						</p>
					) : (
						<ul className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] sm:gap-3">
							{shown.map((identity) => (
								<li key={identity.id}>
									<label className="has-checked:ring-selected has-focus-visible:ring-ring block cursor-pointer rounded-md ring-offset-2 has-checked:ring-3 has-focus-visible:ring-2">
										<input
											type="radio"
											name="identityCardId"
											value={identity.id}
											checked={selected === identity.id}
											onChange={() => setSelected(identity.id)}
											className="sr-only"
										/>
										<IdentityArt identity={identity} />
									</label>
								</li>
							))}
						</ul>
					)}
				</fieldset>

				<div className="bg-background/95 sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t py-3 backdrop-blur-sm">
					{actionData?.error ? (
						<p role="alert" className="text-destructive text-sm">
							{actionData.error}
						</p>
					) : null}
					<StatusButton
						type="submit"
						status={isPending ? 'pending' : 'idle'}
						disabled={isPending || !selected}
					>
						Create deck
					</StatusButton>
				</div>
			</Form>
		</main>
	)
}

export function ErrorBoundary() {
	return <GeneralErrorBoundary />
}
