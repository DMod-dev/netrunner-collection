import { useEffect, useRef, useState } from 'react'
import { data, useFetcher } from 'react-router'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import {
	createVariant,
	deleteVariant,
	setPrintingQuantity,
	setVariantQuantity,
} from '#app/utils/collection.server.ts'
import { MAX_QUANTITY } from '#app/utils/collection.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { type Route } from './+types/collection.ts'

const ACTION_PATH = '/resources/collection'

const quantity = z.coerce.number().int().min(0).max(MAX_QUANTITY)

const CollectionActionSchema = z.discriminatedUnion('intent', [
	z.object({
		intent: z.literal('set-printing-quantity'),
		printingId: z.string().min(1),
		quantity,
	}),
	z.object({
		intent: z.literal('set-variant-quantity'),
		variantId: z.string().min(1),
		quantity,
	}),
	z.object({
		intent: z.literal('create-variant'),
		printingId: z.string().min(1),
		label: z.string().trim().min(1, 'Give the version a name').max(80),
		notes: z.string().trim().max(500).optional(),
	}),
	z.object({
		intent: z.literal('delete-variant'),
		variantId: z.string().min(1),
	}),
])

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const parsed = CollectionActionSchema.safeParse(Object.fromEntries(formData))
	if (!parsed.success) {
		return data(
			{ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' },
			{ status: 400 },
		)
	}

	const submission = parsed.data
	switch (submission.intent) {
		case 'set-printing-quantity': {
			await setPrintingQuantity(
				userId,
				submission.printingId,
				submission.quantity,
			)
			return { ok: true } as const
		}
		case 'set-variant-quantity': {
			const result = await setVariantQuantity(
				userId,
				submission.variantId,
				submission.quantity,
			)
			if (result === null) {
				return data({ ok: false, error: 'Version not found' }, { status: 404 })
			}
			return { ok: true } as const
		}
		case 'create-variant': {
			try {
				await createVariant(userId, submission)
			} catch (error) {
				// unique (userId, printingId, label)
				if (error instanceof Error && error.message.includes('Unique')) {
					return data(
						{ ok: false, error: 'You already have a version with that name' },
						{ status: 400 },
					)
				}
				throw error
			}
			return { ok: true } as const
		}
		case 'delete-variant': {
			await deleteVariant(userId, submission.variantId)
			return { ok: true } as const
		}
	}
}

type QuantityTarget = { printingId: string } | { variantId: string }

/**
 * −/+ buttons with an editable count. Updates are optimistic: the displayed
 * number comes from the in-flight submission until the server catches up.
 */
export function QuantityStepper({
	target,
	quantity,
	label,
	size = 'default',
}: {
	target: QuantityTarget
	quantity: number
	/** Describes what's being counted, for screen readers. */
	label: string
	size?: 'default' | 'sm'
}) {
	const targetId = 'printingId' in target ? target.printingId : target.variantId
	const fetcher = useFetcher<typeof action>({ key: `qty-${targetId}` })
	// The value we last asked the server for, shown until the fetcher settles
	// and the loader has revalidated with the saved quantity.
	const [pendingValue, setPendingValue] = useState<number | null>(null)
	useEffect(() => {
		if (fetcher.state === 'idle') setPendingValue(null)
	}, [fetcher.state])
	const displayed = pendingValue ?? quantity
	// Clicks can land faster than React re-renders, so step from a ref that is
	// updated synchronously rather than from the rendered value.
	const latestRef = useRef(displayed)
	latestRef.current = displayed

	function step(delta: number) {
		submit(latestRef.current + delta)
	}

	function submit(next: number) {
		const clamped = Math.max(0, Math.min(MAX_QUANTITY, next))
		if (clamped === latestRef.current) return
		latestRef.current = clamped
		setPendingValue(clamped)
		void fetcher.submit(
			'printingId' in target
				? {
						intent: 'set-printing-quantity',
						printingId: target.printingId,
						quantity: clamped,
					}
				: {
						intent: 'set-variant-quantity',
						variantId: target.variantId,
						quantity: clamped,
					},
			{ method: 'POST', action: ACTION_PATH },
		)
	}

	const buttonClass = size === 'sm' ? 'size-7 text-base' : 'size-8 text-lg'
	return (
		<div className="flex items-center gap-1">
			<Button
				type="button"
				variant="outline"
				className={cn('p-0', buttonClass)}
				disabled={displayed <= 0}
				onClick={() => step(-1)}
				aria-label={`Remove one ${label}`}
			>
				−
			</Button>
			<QuantityInput
				value={displayed}
				onCommit={submit}
				label={label}
				className={size === 'sm' ? 'h-7 w-10' : 'h-8 w-11'}
			/>
			<Button
				type="button"
				variant="outline"
				className={cn('p-0', buttonClass)}
				disabled={displayed >= MAX_QUANTITY}
				onClick={() => step(1)}
				aria-label={`Add one ${label}`}
			>
				+
			</Button>
		</div>
	)
}

function QuantityInput({
	value,
	onCommit,
	label,
	className,
}: {
	value: number
	onCommit: (value: number) => void
	label: string
	className?: string
}) {
	const [draft, setDraft] = useState(String(value))
	// keep the text in sync when the value changes from the buttons or server
	useEffect(() => setDraft(String(value)), [value])

	function commit() {
		const next = Number.parseInt(draft, 10)
		if (Number.isNaN(next)) setDraft(String(value))
		else onCommit(next)
	}

	return (
		<Input
			type="text"
			inputMode="numeric"
			pattern="[0-9]*"
			aria-label={`${label} quantity`}
			className={cn(
				'px-1 text-center tabular-nums',
				value > 0 ? 'font-bold' : 'text-muted-foreground',
				className,
			)}
			value={draft}
			onChange={(e) => setDraft(e.currentTarget.value.replace(/\D/g, ''))}
			onFocus={(e) => e.currentTarget.select()}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') e.currentTarget.blur()
				if (e.key === 'Escape') {
					setDraft(String(value))
					e.currentTarget.blur()
				}
			}}
		/>
	)
}

export function AddVariantForm({
	printingId,
	onDone,
}: {
	printingId: string
	onDone: () => void
}) {
	const fetcher = useFetcher<typeof action>()
	const inputRef = useRef<HTMLInputElement>(null)
	const isPending = fetcher.state !== 'idle'
	const error =
		fetcher.state === 'idle' && fetcher.data && !fetcher.data.ok
			? fetcher.data.error
			: null

	useEffect(() => {
		if (fetcher.state === 'idle' && fetcher.data?.ok) onDone()
	}, [fetcher.state, fetcher.data, onDone])

	return (
		<fetcher.Form
			method="POST"
			action={ACTION_PATH}
			className="flex flex-col gap-1"
		>
			<input type="hidden" name="intent" value="create-variant" />
			<input type="hidden" name="printingId" value={printingId} />
			<div className="flex gap-1">
				<Input
					ref={inputRef}
					name="label"
					placeholder="e.g. Worlds 2024 alt art"
					aria-label="Version name"
					className="h-8 text-sm"
					autoFocus
					required
					maxLength={80}
					onKeyDown={(e) => {
						if (e.key === 'Escape') onDone()
					}}
				/>
				<Button type="submit" size="sm" className="h-8" disabled={isPending}>
					Add
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-8 px-2"
					onClick={onDone}
					aria-label="Cancel"
				>
					<Icon name="cross-1" />
				</Button>
			</div>
			{error ? (
				<p className="text-foreground-destructive text-xs">{error}</p>
			) : null}
		</fetcher.Form>
	)
}

export function DeleteVariantButton({
	variantId,
	label,
}: {
	variantId: string
	label: string
}) {
	const fetcher = useFetcher<typeof action>()
	const dc = useDoubleCheck()
	return (
		<fetcher.Form method="POST" action={ACTION_PATH}>
			<input type="hidden" name="intent" value="delete-variant" />
			<input type="hidden" name="variantId" value={variantId} />
			<Button
				variant={dc.doubleCheck ? 'destructive' : 'ghost'}
				size="sm"
				className="h-7 px-2 text-xs"
				{...dc.getButtonProps({ type: 'submit' })}
				aria-label={
					dc.doubleCheck ? `Confirm delete ${label}` : `Delete ${label}`
				}
			>
				{dc.doubleCheck ? 'Delete?' : <Icon name="trash" />}
			</Button>
		</fetcher.Form>
	)
}
