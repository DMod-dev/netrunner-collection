import { Trash01 } from '@untitledui/icons'
import { useEffect, useId, useRef } from 'react'
import { data, Form, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { Switch } from '#app/components/ui/switch.tsx'
import {
	STEPPER_SET_EVENT,
	STEPPER_STEP_EVENT,
} from '#app/routes/resources/collection.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { DECK_FORMATS } from '#app/utils/deck-formats.ts'
import {
	deleteDeck,
	type DeckWriteError,
	setDeckCardQuantity,
	setDeckIdentity,
	updateDeck,
} from '#app/utils/deck.server.ts'
import {
	deckCardFetcherKey,
	deckSettingsFetcherKey,
	MAX_DECK_NAME_LENGTH,
	MAX_DECK_NOTES_LENGTH,
	MAX_DECK_QUANTITY,
} from '#app/utils/deck.ts'
import { ensurePrimary } from '#app/utils/litefs.server.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/deck.ts'

export const DECK_ACTION_PATH = '/resources/deck'

const deckId = z.string().min(1)

// `fill`/`unfill` (reserving copies from the collection) and `import` join
// this union later.
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
	z.object({ intent: z.literal('delete'), deckId }),
])

function refused({ error, status }: DeckWriteError) {
	return data({ ok: false, error } as const, { status })
}

const notFound = () => refused({ error: 'Deck not found', status: 404 })

export async function action({ request }: Route.ActionArgs) {
	// Every write below is scoped to decks this user owns; anyone else's deck
	// id is a 404, the same as one that doesn't exist.
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

	const small = size === 'sm'
	// big enough to tap on touch screens
	const buttonClass = cn(
		small ? 'size-7 text-base' : 'size-9 text-lg',
		'pointer-coarse:size-11',
	)
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

/**
 * "Require deck legality". Off, a deck's format problems (bans, rotation,
 * points) are warnings instead of errors. Optimistic via `pendingLegality`.
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
