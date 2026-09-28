import { ChevronDown, Copy01, Trash01 } from '@untitledui/icons'
import { useEffect, useId, useRef } from 'react'
import { data, Form, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Switch } from '#app/components/ui/switch.tsx'
import {
	STEPPER_SET_EVENT,
	STEPPER_STEP_EVENT,
} from '#app/routes/resources/collection.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { sendBorrowNotifications } from '#app/utils/borrowing-email.server.tsx'
import {
	fillFromLender,
	returnToLender,
	setBorrowed,
} from '#app/utils/borrowing.server.ts'
import { DeckImportError } from '#app/utils/deck-check.server.ts'
import {
	fillDeck,
	type FillReport,
	setFromCollection,
	unfillDeck,
} from '#app/utils/deck-fill.server.ts'
import { DECK_FORMAT_NAMES, DECK_FORMATS } from '#app/utils/deck-formats.ts'
import {
	readDeckInput,
	replaceDeckCards,
} from '#app/utils/deck-import.server.ts'
import { MAX_UNRECOGNIZED_SHOWN } from '#app/utils/deck-import.ts'
import {
	copyDeck,
	deleteDeck,
	type DeckWriteError,
	removeIllegalCards,
	setDeckCardQuantity,
	setDeckIdentity,
	updateDeck,
} from '#app/utils/deck.server.ts'
import {
	deckBorrowFetcherKey,
	deckCardFetcherKey,
	deckCollectionFetcherKey,
	deckSettingsFetcherKey,
	MAX_DECK_NAME_LENGTH,
	MAX_DECK_NOTES_LENGTH,
	MAX_DECK_QUANTITY,
} from '#app/utils/deck.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import {
	cn,
	getDomainUrl,
	useDoubleCheck,
	useIsPending,
} from '#app/utils/misc.tsx'
import {
	createToastHeaders,
	redirectWithToast,
	type ToastInput,
} from '#app/utils/toast.server.ts'
import { type Route } from './+types/deck.ts'

export const DECK_ACTION_PATH = '/resources/deck'

const deckId = z.string().min(1)

const DeckActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('set-card-quantity'),
		deckId,
		cardId: z.string().min(1),
		// digits only: a blank must not read as 0 and take the card out
		quantity: z
			.string()
			.regex(/^\d+$/, 'Invalid quantity')
			.transform(Number)
			.pipe(z.number().int().max(MAX_DECK_QUANTITY)),
	}),
	z.object({
		intent: z.literal('set-from-collection'),
		deckId,
		cardId: z.string().min(1),
		fromCollection: z
			.string()
			.regex(/^\d+$/, 'Invalid quantity')
			.transform(Number)
			.pipe(z.number().int().max(MAX_DECK_QUANTITY)),
	}),
	z.object({
		intent: z.literal('set-identity'),
		deckId,
		identityCardId: z.string().min(1),
	}),
	z.object({
		intent: z.literal('rename'),
		deckId,
		name: z
			.string()
			.trim()
			.min(1, 'Give the deck a name')
			.max(MAX_DECK_NAME_LENGTH),
	}),
	z.object({
		intent: z.literal('set-notes'),
		deckId,
		notes: z.string().trim().max(MAX_DECK_NOTES_LENGTH).default(''),
	}),
	z.object({
		intent: z.literal('set-format'),
		deckId,
		formatId: z.enum(DECK_FORMATS),
	}),
	z.object({
		intent: z.literal('set-require-legality'),
		deckId,
		requireLegality: z.enum(['true', 'false']).transform((v) => v === 'true'),
	}),
	z.object({
		intent: z.literal('set-public'),
		deckId,
		isPublic: z.enum(['true', 'false']).transform((v) => v === 'true'),
	}),
	// a copy of the user's own deck or anyone's public one, for them to change
	z.object({ intent: z.literal('copy'), deckId }),
	z.object({ intent: z.literal('fill'), deckId }),
	z.object({ intent: z.literal('unfill'), deckId }),
	// ask a lender (sharing their collection with you) for the copies the
	// deck has no source for
	z.object({
		intent: z.literal('fill-from-lender'),
		deckId,
		lenderId: z.string().min(1),
	}),
	z.object({
		intent: z.literal('set-borrowed'),
		deckId,
		cardId: z.string().min(1),
		lenderId: z.string().min(1),
		borrowed: z
			.string()
			.regex(/^\d+$/, 'Invalid quantity')
			.transform(Number)
			.pipe(z.number().int().max(MAX_DECK_QUANTITY)),
	}),
	// give back every copy borrowed from (or asked of) a lender
	z.object({
		intent: z.literal('return-to-lender'),
		deckId,
		lenderId: z.string().min(1),
	}),
	// replace the deck's cards with a pasted list or NetrunnerDB link
	z.object({
		intent: z.literal('import'),
		deckId,
		deck: z.string().default(''),
	}),
	// take out every card the deck's format doesn't allow
	z.object({ intent: z.literal('remove-illegal'), deckId }),
	z.object({ intent: z.literal('delete'), deckId }),
])

/** "Took 41 of 45 cards from your collection", and so on. */
export function fillMessage({
	taken,
	total,
}: {
	taken: number
	total: number
}) {
	const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`
	if (total === 0) return 'This deck has no cards to fill yet'
	if (taken === total) {
		return `Took ${total === 1 ? 'the card' : `all ${cards(total)}`} from your collection`
	}
	if (taken === 0)
		return 'None of this deck’s cards are free in your collection'
	return `Took ${taken} of ${cards(total)} from your collection`
}

/** "Asked for 12 of 15 cards", and so on. */
export function borrowMessage({
	asked,
	open,
}: {
	asked: number
	open: number
}) {
	const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`
	if (open === 0) return 'Every card already has a source'
	if (asked === 0)
		return 'None of the cards this deck still needs are free to borrow'
	const what = asked === open ? cards(asked) : `${asked} of ${cards(open)}`
	return `Asked to borrow ${what}; they’re pending until approved`
}

/**
 * What an import did: the fill report (or `unfilled`, for a deck that isn't
 * filled from the collection) and the lines it couldn't match, listed until
 * the toast is closed.
 */
export function importToast({
	title,
	report,
	unfilled,
	unrecognized,
}: {
	title: string
	report: FillReport | null
	unfilled: string
	unrecognized: string[]
}): ToastInput {
	const summary = report ? fillMessage(report) : unfilled
	if (unrecognized.length === 0) {
		return {
			type: !report || report.taken === report.total ? 'success' : 'message',
			title,
			description: summary,
		}
	}
	const shown = unrecognized
		.slice(0, MAX_UNRECOGNIZED_SHOWN)
		.map((line) => (line.length > 80 ? `${line.slice(0, 79)}…` : line))
	const more = unrecognized.length - shown.length
	const lines = `${unrecognized.length} ${unrecognized.length === 1 ? 'line' : 'lines'}`
	return {
		type: 'message',
		title,
		description: `${summary}. Couldn’t match ${lines}:`,
		details: more > 0 ? [...shown, `…and ${more} more`] : shown,
	}
}

function refused({ error, status }: DeckWriteError) {
	return data({ ok: false, error } as const, { status })
}

const notFound = () => refused({ error: 'Deck not found', status: 404 })

export async function action({ request }: Route.ActionArgs) {
	// Every write below is scoped to decks this user owns; anyone else's deck
	// id is a 404, the same as one that doesn't exist. Only `copy` reads
	// someone else's deck, and only a public one.
	const userId = await requireUserId(request)
	await ensurePrimary()
	const formData = await request.formData()
	const parsed = DeckActionSchema.safeParse(Object.fromEntries(formData))
	if (!parsed.success) {
		return data(
			{
				ok: false,
				error: parsed.error.issues[0]?.message ?? 'Invalid',
			} as const,
			{ status: 400 },
		)
	}

	const submission = parsed.data
	switch (submission.intent) {
		case 'set-card-quantity': {
			const result = await setDeckCardQuantity(
				userId,
				submission.deckId,
				submission.cardId,
				submission.quantity,
			)
			if ('error' in result) return refused(result)
			return { ok: true } as const
		}
		case 'set-from-collection': {
			const result = await setFromCollection(
				userId,
				submission.deckId,
				submission.cardId,
				submission.fromCollection,
			)
			if (!result) return notFound()
			if ('error' in result) {
				return refused({ error: result.error, status: 400 })
			}
			return { ok: true } as const
		}
		case 'set-identity': {
			const result = await setDeckIdentity(
				userId,
				submission.deckId,
				submission.identityCardId,
			)
			if ('error' in result) return refused(result)
			return { ok: true } as const
		}
		case 'rename': {
			const { deckId, name } = submission
			if (!(await updateDeck(userId, deckId, { name }))) return notFound()
			return { ok: true } as const
		}
		case 'set-notes': {
			const { deckId, notes } = submission
			if (!(await updateDeck(userId, deckId, { notes: notes || null }))) {
				return notFound()
			}
			return { ok: true } as const
		}
		case 'set-format': {
			const { deckId, formatId } = submission
			if (!(await updateDeck(userId, deckId, { formatId }))) return notFound()
			return { ok: true } as const
		}
		case 'set-require-legality': {
			const { deckId, requireLegality } = submission
			if (!(await updateDeck(userId, deckId, { requireLegality }))) {
				return notFound()
			}
			return { ok: true } as const
		}
		case 'set-public': {
			const { deckId, isPublic } = submission
			if (!(await updateDeck(userId, deckId, { isPublic }))) {
				return notFound()
			}
			return { ok: true } as const
		}
		case 'copy': {
			const copy = await copyDeck(userId, submission.deckId)
			if (!copy) return notFound()
			throw await redirectWithToast(`/decks/${copy.id}`, {
				type: 'success',
				description: `Copied to your decks as ${copy.name}`,
			})
		}
		case 'fill': {
			const report = await fillDeck(userId, submission.deckId)
			if (!report) return notFound()
			return data({ ok: true } as const, {
				headers: await createToastHeaders({
					type: report.taken === report.total ? 'success' : 'message',
					description: fillMessage(report),
				}),
			})
		}
		case 'fill-from-lender': {
			const result = await fillFromLender(
				userId,
				submission.deckId,
				submission.lenderId,
			)
			if (!result) return notFound()
			if ('error' in result) return refused(result)
			void sendBorrowNotifications(result.notifications, getDomainUrl(request))
			return data({ ok: true } as const, {
				headers: await createToastHeaders({
					type:
						result.asked > 0 && result.asked === result.open
							? 'success'
							: 'message',
					description: borrowMessage(result),
				}),
			})
		}
		case 'set-borrowed': {
			const result = await setBorrowed(
				userId,
				submission.deckId,
				submission.cardId,
				submission.lenderId,
				submission.borrowed,
			)
			if (!result) return notFound()
			if ('error' in result) return refused(result)
			void sendBorrowNotifications(result.notifications, getDomainUrl(request))
			return { ok: true } as const
		}
		case 'return-to-lender': {
			const result = await returnToLender(
				userId,
				submission.deckId,
				submission.lenderId,
			)
			if (!result) return notFound()
			return data({ ok: true } as const, {
				headers: await createToastHeaders({
					type: 'success',
					description: `Gave back ${result.returned} borrowed ${result.returned === 1 ? 'card' : 'cards'}`,
				}),
			})
		}
		case 'unfill': {
			if (!(await unfillDeck(userId, submission.deckId))) return notFound()
			return data({ ok: true } as const, {
				headers: await createToastHeaders({
					type: 'success',
					description: 'Gave this deck’s cards back to your collection',
				}),
			})
		}
		case 'import': {
			const { deckId } = submission
			try {
				const requirements = await readDeckInput(submission.deck)
				const result = await replaceDeckCards(userId, deckId, requirements)
				if (!result) return notFound()
				// a filled deck stays filled: reserve what the new cards need
				const report = result.wasFilled ? await fillDeck(userId, deckId) : null
				return data({ ok: true } as const, {
					headers: await createToastHeaders(
						importToast({
							title: 'Cards replaced',
							report,
							unfilled: 'Replaced this deck’s cards',
							unrecognized: result.unrecognized,
						}),
					),
				})
			} catch (error) {
				if (error instanceof DeckImportError) {
					return refused({ error: error.message, status: 400 })
				}
				throw error
			}
		}
		case 'remove-illegal': {
			const result = await removeIllegalCards(userId, submission.deckId)
			if (!result) return notFound()
			const format = DECK_FORMAT_NAMES[result.formatId]
			return data({ ok: true } as const, {
				headers: await createToastHeaders({
					type: 'success',
					description: result.removed
						? `Removed ${result.removed} ${result.removed === 1 ? 'card' : 'cards'} not legal in ${format}`
						: `Every card is legal in ${format}`,
				}),
			})
		}
		case 'delete': {
			if (!(await deleteDeck(userId, submission.deckId))) return notFound()
			throw await redirectWithToast('/decks', {
				type: 'success',
				description: 'Deck deleted',
			})
		}
	}
}

/**
 * A 500 or a dropped connection would otherwise replace the whole page with
 * the error boundary. Report it like any other failed change instead; the
 * loaders still revalidate, so the page goes back to what's saved. Redirects
 * (after deleting a deck) still go through.
 */
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	try {
		return await serverAction()
	} catch (error) {
		if (error instanceof Response) throw error
		return {
			ok: false,
			error: 'Couldn’t save your change. Please try again.',
		} as const
	}
}

/** Toast a fetcher's error once it settles; the UI reverts on its own. */
export function useErrorToast(
	fetcher: ReturnType<typeof useFetcher<typeof clientAction>>,
	label: string,
	id: string,
) {
	useEffect(() => {
		if (fetcher.state !== 'idle' || !fetcher.data || fetcher.data.ok) return
		toast.error(`${label}: ${fetcher.data.error}`, { id })
	}, [fetcher.state, fetcher.data, label, id])
}

/**
 * The count a submission is asking for, while it's in flight. It stays until
 * the loaders have revalidated, so the number never flickers back.
 */
export function pendingQuantity(formData: FormData | undefined) {
	if (formData?.get('intent') !== 'set-card-quantity') return null
	const quantity = Number(formData.get('quantity'))
	return Number.isInteger(quantity) ? quantity : null
}

/**
 * −/+ for how many copies of a card are in a deck. Optimistic: the builder
 * reads every in-flight change (they share a fetcher key prefix) to update
 * the decklist and stats at once. Listens for the card tile's keyboard
 * shortcut events like the collection's `QuantityStepper`.
 */
export function DeckQuantityStepper({
	deckId,
	cardId,
	title,
	quantity,
	deckLimit,
	size = 'default',
}: {
	deckId: string
	cardId: string
	title: string
	quantity: number
	deckLimit: number
	size?: 'default' | 'sm'
}) {
	const key = deckCardFetcherKey(deckId, cardId)
	const fetcher = useFetcher<typeof clientAction>({ key })
	const displayed = pendingQuantity(fetcher.formData) ?? quantity
	useErrorToast(fetcher, title, key)
	// Clicks can land faster than React re-renders, so step from a ref that
	// each click updates synchronously rather than from the rendered value.
	// It follows the rendered value otherwise (the server answering, another
	// stepper for the same card).
	const latestRef = useRef(displayed)
	useEffect(() => {
		latestRef.current = displayed
	}, [displayed])

	function submit(next: number) {
		const clamped = Math.max(0, Math.min(MAX_DECK_QUANTITY, next))
		if (clamped === latestRef.current) return
		latestRef.current = clamped
		void fetcher.submit(
			{ intent: 'set-card-quantity', deckId, cardId, quantity: clamped },
			{ method: 'POST', action: DECK_ACTION_PATH },
		)
	}

	const rootRef = useRef<HTMLDivElement>(null)
	// re-subscribed each render so the handlers see the current count
	useEffect(() => {
		const root = rootRef.current
		if (!root) return
		const onStep = (e: Event) =>
			submit(latestRef.current + (e as CustomEvent<number>).detail)
		const onSet = (e: Event) => submit((e as CustomEvent<number>).detail)
		root.addEventListener(STEPPER_STEP_EVENT, onStep)
		root.addEventListener(STEPPER_SET_EVENT, onSet)
		return () => {
			root.removeEventListener(STEPPER_STEP_EVENT, onStep)
			root.removeEventListener(STEPPER_SET_EVENT, onSet)
		}
	})

	const buttonClass = stepperButtonClass(size)
	return (
		<div
			ref={rootRef}
			data-quantity-stepper
			className="flex items-center gap-1"
		>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed <= 0}
				onClick={() => submit(latestRef.current - 1)}
				aria-label={`Remove one ${title} from the deck`}
			>
				−
			</Button>
			<output
				aria-label={`${title} in deck`}
				className={cn(
					'min-w-8 text-center text-sm tabular-nums',
					displayed > deckLimit
						? 'text-destructive font-bold'
						: displayed > 0
							? 'font-bold'
							: 'text-muted-foreground',
				)}
			>
				{displayed}/{deckLimit}
			</output>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed >= MAX_DECK_QUANTITY}
				onClick={() => submit(latestRef.current + 1)}
				aria-label={`Add one ${title} to the deck`}
			>
				+
			</Button>
		</div>
	)
}

function stepperButtonClass(size: 'default' | 'sm') {
	return cn(
		size === 'sm' ? 'size-7 text-base' : 'size-9 text-lg',
		// big enough to tap on touch screens
		'pointer-coarse:size-11',
	)
}

/**
 * The copies of a card the deck takes from the collection, while a change is
 * in flight (see `pendingQuantity`).
 */
export function pendingFromCollection(formData: FormData | undefined) {
	if (formData?.get('intent') !== 'set-from-collection') return null
	const fromCollection = Number(formData.get('fromCollection'))
	return Number.isInteger(fromCollection) ? fromCollection : null
}

/**
 * −/+ for how many of a deck's copies of a card come from the collection, up
 * to `max`: the copies it plays, or fewer if other decks hold the rest.
 * Optimistic like `DeckQuantityStepper`.
 */
export function DeckCollectionStepper({
	deckId,
	cardId,
	title,
	fromCollection,
	max,
	size = 'default',
}: {
	deckId: string
	cardId: string
	title: string
	fromCollection: number
	max: number
	size?: 'default' | 'sm'
}) {
	const key = deckCollectionFetcherKey(deckId, cardId)
	const fetcher = useFetcher<typeof clientAction>({ key })
	const displayed = pendingFromCollection(fetcher.formData) ?? fromCollection
	useErrorToast(fetcher, title, key)
	// as in DeckQuantityStepper: clicks can outrun re-renders
	const latestRef = useRef(displayed)
	useEffect(() => {
		latestRef.current = displayed
	}, [displayed])

	function submit(next: number) {
		const clamped = Math.max(0, Math.min(max, next))
		if (clamped === latestRef.current) return
		latestRef.current = clamped
		void fetcher.submit(
			{
				intent: 'set-from-collection',
				deckId,
				cardId,
				fromCollection: clamped,
			},
			{ method: 'POST', action: DECK_ACTION_PATH },
		)
	}

	const buttonClass = stepperButtonClass(size)
	return (
		<div className="flex items-center gap-1">
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed <= 0}
				onClick={() => submit(latestRef.current - 1)}
				aria-label={`Give one ${title} back to your collection`}
			>
				−
			</Button>
			<output
				aria-label={`${title} from your collection`}
				className={cn(
					'min-w-8 text-center text-sm tabular-nums',
					displayed > 0 ? 'font-bold' : 'text-muted-foreground',
				)}
			>
				{displayed}
			</output>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed >= max}
				onClick={() => submit(latestRef.current + 1)}
				aria-label={`Take one ${title} from your collection`}
			>
				+
			</Button>
		</div>
	)
}

/**
 * "Require deck legality". On, a deck's format problems (bans, rotation,
 * points) show as warnings; off, they aren't checked. Optimistic via
 * `pendingLegality`.
 */
export function RequireLegalitySwitch({
	deckId,
	requireLegality,
}: {
	deckId: string
	requireLegality: boolean
}) {
	const id = useId()
	const fetcher = useFetcher<typeof clientAction>({
		key: deckSettingsFetcherKey(deckId, 'legality'),
	})
	useErrorToast(fetcher, 'Require deck legality', `legality-${deckId}`)
	const checked = pendingLegality(fetcher.formData) ?? requireLegality
	return (
		<div className="flex items-center gap-2">
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={(next: boolean) => {
					void fetcher.submit(
						{
							intent: 'set-require-legality',
							deckId,
							requireLegality: String(next),
						},
						{ method: 'POST', action: DECK_ACTION_PATH },
					)
				}}
			/>
			<Label htmlFor={id} className="text-sm font-normal">
				Require deck legality
			</Label>
		</div>
	)
}

export function pendingLegality(formData: FormData | undefined) {
	if (formData?.get('intent') !== 'set-require-legality') return null
	return formData.get('requireLegality') === 'true'
}

/**
 * "Public": on, anyone can find the deck in the decklist search and open its
 * link; off, only its owner sees it. Optimistic via `pendingPublic`.
 */
export function PublicDeckSwitch({
	deckId,
	isPublic,
}: {
	deckId: string
	isPublic: boolean
}) {
	const id = useId()
	const fetcher = useFetcher<typeof clientAction>({
		key: deckSettingsFetcherKey(deckId, 'visibility'),
	})
	useErrorToast(fetcher, 'Public', `visibility-${deckId}`)
	const checked = pendingPublic(fetcher.formData) ?? isPublic
	return (
		<div className="flex items-center gap-2">
			<Switch
				id={id}
				checked={checked}
				aria-describedby={`${id}-hint`}
				onCheckedChange={(next: boolean) => {
					void fetcher.submit(
						{ intent: 'set-public', deckId, isPublic: String(next) },
						{ method: 'POST', action: DECK_ACTION_PATH },
					)
				}}
			/>
			<Label htmlFor={id} className="text-sm font-normal">
				Public
			</Label>
			<span id={`${id}-hint`} className="sr-only">
				{checked
					? 'Anyone can find this deck and open its link'
					: 'Only you can see this deck'}
			</span>
		</div>
	)
}

export function pendingPublic(formData: FormData | undefined) {
	if (formData?.get('intent') !== 'set-public') return null
	return formData.get('isPublic') === 'true'
}

/** Make a copy of the deck in the user's decks and open it. */
export function CopyDeckButton({
	deckId,
	variant = 'outline',
}: {
	deckId: string
	variant?: 'default' | 'outline'
}) {
	const pending = useIsPending({ formAction: DECK_ACTION_PATH })
	return (
		<Form method="POST" action={DECK_ACTION_PATH}>
			<input type="hidden" name="intent" value="copy" />
			<input type="hidden" name="deckId" value={deckId} />
			<StatusButton
				type="submit"
				variant={variant}
				status={pending ? 'pending' : 'idle'}
				disabled={pending}
			>
				<Icon icon={Copy01}>Copy to my decks</Icon>
			</StatusButton>
		</Form>
	)
}

export function DeleteDeckButton({
	deckId,
	name,
}: {
	deckId: string
	name: string
}) {
	const dc = useDoubleCheck()
	return (
		<Form method="POST" action={DECK_ACTION_PATH}>
			<input type="hidden" name="intent" value="delete" />
			<input type="hidden" name="deckId" value={deckId} />
			<Button
				variant={dc.doubleCheck ? 'destructive' : 'outline'}
				{...dc.getButtonProps({ type: 'submit' })}
				aria-label={
					dc.doubleCheck ? `Confirm delete ${name}` : `Delete ${name}`
				}
			>
				<Icon icon={Trash01}>{dc.doubleCheck ? 'Delete?' : 'Delete'}</Icon>
			</Button>
		</Form>
	)
}

/**
 * Take the cards the format doesn't allow out of the deck, after a second
 * click to confirm. Shown whether or not legality is required.
 */
export function RemoveIllegalCardsButton({
	deckId,
	count,
	formatName,
}: {
	deckId: string
	/** copies the format doesn't allow */
	count: number
	formatName: string
}) {
	const fetcher = useFetcher<typeof clientAction>({
		key: deckSettingsFetcherKey(deckId, 'remove-illegal'),
	})
	useErrorToast(fetcher, 'Remove cards', `remove-illegal-${deckId}`)
	const dc = useDoubleCheck()
	const busy = fetcher.state !== 'idle'
	const cards = `${count} ${count === 1 ? 'card' : 'cards'}`
	return (
		<fetcher.Form method="POST" action={DECK_ACTION_PATH}>
			<input type="hidden" name="intent" value="remove-illegal" />
			<input type="hidden" name="deckId" value={deckId} />
			<StatusButton
				size="sm"
				variant={dc.doubleCheck ? 'destructive' : 'outline'}
				status={busy ? 'pending' : 'idle'}
				disabled={busy}
				{...dc.getButtonProps({ type: 'submit' })}
			>
				{dc.doubleCheck
					? `Remove ${cards}?`
					: `Remove ${cards} not legal in ${formatName}`}
			</StatusButton>
		</fetcher.Form>
	)
}

/** The intent a fill fetcher is submitting, while it's in flight. */
function pendingFillIntent(formData: FormData | undefined) {
	const intent = formData?.get('intent')
	return intent === 'fill' ||
		intent === 'unfill' ||
		intent === 'fill-from-lender' ||
		intent === 'return-to-lender'
		? intent
		: null
}

/** A collection shared with the deck's owner, for the fill menu. */
export type FillLender = {
	id: string
	name: string
	/** copies the deck borrows from them, lent or asked for */
	borrowed: number
}

/**
 * "Fill with collection" until the deck is filled; then a "From collection"
 * menu to fill again (after the collection or the deck changed) or unfill.
 * With collections shared with the owner it's always a menu, which can also
 * fill from each of them (asking to borrow) and give their cards back.
 */
export function FillControls({
	deckId,
	filled,
	fromCollection,
	borrowed,
	total,
	lenders,
}: {
	deckId: string
	filled: boolean
	/** copies reserved from the collection, the identity included */
	fromCollection: number
	/** copies borrowed, lent or asked for */
	borrowed: number
	/** copies the deck plays, the identity included */
	total: number
	lenders: FillLender[]
}) {
	const fetcher = useFetcher<typeof clientAction>({
		key: deckSettingsFetcherKey(deckId, 'fill'),
	})
	useErrorToast(fetcher, 'Fill with collection', `fill-${deckId}`)
	const pending = pendingFillIntent(fetcher.formData)
	const submit = (
		intent: 'fill' | 'unfill' | 'fill-from-lender' | 'return-to-lender',
		lenderId?: string,
	) =>
		fetcher.submit(
			{ intent, deckId, ...(lenderId ? { lenderId } : {}) },
			{ method: 'POST', action: DECK_ACTION_PATH },
		)

	if (lenders.length === 0 && (!filled || pending === 'fill')) {
		return (
			<StatusButton
				type="button"
				variant="outline"
				status={pending ? 'pending' : 'idle'}
				disabled={pending !== null}
				onClick={() => void submit('fill')}
			>
				Fill with collection
			</StatusButton>
		)
	}
	const pendingLabel =
		pending === 'unfill' || pending === 'return-to-lender'
			? 'Giving back…'
			: pending
				? 'Filling…'
				: null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant={filled ? 'secondary' : 'outline'}
						className={cn(filled && 'rounded-full')}
						disabled={pending !== null}
					/>
				}
			>
				{pendingLabel ??
					(filled ? (
						<>
							From collection{' '}
							<span className="tabular-nums">
								{fromCollection + borrowed}/{total}
							</span>
						</>
					) : (
						'Fill from collection'
					))}
				<Icon icon={ChevronDown} size="sm" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					{lenders.length ? (
						<DropdownMenuLabel>Fill from</DropdownMenuLabel>
					) : null}
					<DropdownMenuItem onClick={() => void submit('fill')}>
						{lenders.length
							? 'My collection'
							: filled
								? 'Fill again'
								: 'Fill with collection'}
					</DropdownMenuItem>
					{lenders.map((lender) => (
						<DropdownMenuItem
							key={lender.id}
							onClick={() => void submit('fill-from-lender', lender.id)}
						>
							{lender.name}’s collection (borrow)
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
				{fromCollection > 0 || lenders.some((l) => l.borrowed > 0) ? (
					<DropdownMenuSeparator />
				) : null}
				{fromCollection > 0 ? (
					<DropdownMenuItem onClick={() => void submit('unfill')}>
						Unfill (give the cards back)
					</DropdownMenuItem>
				) : null}
				{lenders
					.filter((lender) => lender.borrowed > 0)
					.map((lender) => (
						<DropdownMenuItem
							key={lender.id}
							onClick={() => void submit('return-to-lender', lender.id)}
						>
							Give back {lender.name}’s cards
						</DropdownMenuItem>
					))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/**
 * The copies of a card the deck borrows from a lender, while a change is in
 * flight (see `pendingQuantity`).
 */
export function pendingBorrowed(formData: FormData | undefined) {
	if (formData?.get('intent') !== 'set-borrowed') return null
	const borrowed = Number(formData.get('borrowed'))
	return Number.isInteger(borrowed) ? borrowed : null
}

/**
 * −/+ for how many of a deck's copies of a card are borrowed from a lender,
 * up to `max`. + asks for another (it's pending until they approve); −
 * takes back one still asked for, or gives a lent one back. Optimistic like
 * `DeckQuantityStepper`.
 */
export function DeckBorrowStepper({
	deckId,
	cardId,
	lenderId,
	lenderName,
	title,
	borrowed,
	max,
	size = 'default',
}: {
	deckId: string
	cardId: string
	lenderId: string
	lenderName: string
	title: string
	borrowed: number
	max: number
	size?: 'default' | 'sm'
}) {
	const key = deckBorrowFetcherKey(deckId, cardId, lenderId)
	const fetcher = useFetcher<typeof clientAction>({ key })
	const displayed = pendingBorrowed(fetcher.formData) ?? borrowed
	useErrorToast(fetcher, title, key)
	// as in DeckQuantityStepper: clicks can outrun re-renders
	const latestRef = useRef(displayed)
	useEffect(() => {
		latestRef.current = displayed
	}, [displayed])

	function submit(next: number) {
		const clamped = Math.max(0, Math.min(max, next))
		if (clamped === latestRef.current) return
		latestRef.current = clamped
		void fetcher.submit(
			{ intent: 'set-borrowed', deckId, cardId, lenderId, borrowed: clamped },
			{ method: 'POST', action: DECK_ACTION_PATH },
		)
	}

	const buttonClass = stepperButtonClass(size)
	return (
		<div className="flex items-center gap-1">
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed <= 0}
				onClick={() => submit(latestRef.current - 1)}
				aria-label={`Give one ${title} back to ${lenderName}`}
			>
				−
			</Button>
			<output
				aria-label={`${title} borrowed from ${lenderName}`}
				className={cn(
					'min-w-8 text-center text-sm tabular-nums',
					displayed > 0 ? 'font-bold' : 'text-muted-foreground',
				)}
			>
				{displayed}
			</output>
			<Button
				type="button"
				variant="outline"
				size="icon"
				className={buttonClass}
				disabled={displayed >= max}
				onClick={() => submit(latestRef.current + 1)}
				aria-label={`Ask ${lenderName} for one more ${title}`}
			>
				+
			</Button>
		</div>
	)
}

/**
 * The stale-fill hint's button: the same fetcher as `FillControls`, so both
 * show it filling.
 */
export function RefillButton({ deckId }: { deckId: string }) {
	const fetcher = useFetcher<typeof clientAction>({
		key: deckSettingsFetcherKey(deckId, 'fill'),
	})
	const pending = pendingFillIntent(fetcher.formData)
	return (
		<Button
			type="button"
			size="sm"
			variant="outline"
			disabled={pending !== null}
			onClick={() =>
				void fetcher.submit(
					{ intent: 'fill', deckId },
					{ method: 'POST', action: DECK_ACTION_PATH },
				)
			}
		>
			{pending === 'fill' ? 'Filling…' : 'Fill again'}
		</Button>
	)
}
