import { DotsHorizontal, XClose } from '@untitledui/icons'
import { useEffect, useRef, useState } from 'react'
import {
	DefaultArtButton,
	QuantityStepper,
	STEPPER_SET_EVENT,
	STEPPER_STEP_EVENT,
} from '#app/routes/resources/collection.tsx'
import { type PrintingWithCounts } from '#app/utils/collection.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { useCollectionAccess } from './collection-access-context.tsx'
import { PrintingTile, StaticQuantity } from './printing-tile.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

// The tile the pointer or keyboard focus most recently entered. Keyboard
// shortcuts apply to it alone, even if the mouse rests on another tile.
let activeTile: HTMLElement | null = null

function isEditable(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
	)
}

/**
 * + / − step the active tile's primary counter; a digit sets it.
 * Returns the event to dispatch to the stepper, or null for other keys.
 */
function shortcutEvent(key: string) {
	if (key === '+' || key === '=') {
		return new CustomEvent(STEPPER_STEP_EVENT, { detail: 1 })
	}
	if (key === '-' || key === '_') {
		return new CustomEvent(STEPPER_STEP_EVENT, { detail: -1 })
	}
	if (/^[0-9]$/.test(key)) {
		return new CustomEvent(STEPPER_SET_EVENT, { detail: Number(key) })
	}
	return null
}

/**
 * Card art that reveals `overlay` on hover. Hover doesn't exist on touch
 * screens, so tapping (or pressing Enter on) the art pins the overlay open
 * until you tap elsewhere or press Escape. Keyboard focus inside the overlay
 * also keeps it open.
 */
export function CardArtTile({
	imageUrl,
	alt,
	dimmed = false,
	compact = false,
	badge,
	overlay,
}: {
	imageUrl: string | null
	alt: string
	/** Wash out the art, e.g. when none are owned. */
	dimmed?: boolean
	/** Less padding around the overlay, for small tiles. */
	compact?: boolean
	/**
	 * Shown in the corner of the art while the overlay is closed, e.g. the
	 * owned count. Hidden from screen readers: repeat it in the overlay.
	 */
	badge?: React.ReactNode
	overlay: React.ReactNode
}) {
	const [pinned, setPinned] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const tile = ref.current
		function onKeyDown(event: KeyboardEvent) {
			if (!tile || activeTile !== tile) return
			if (event.defaultPrevented || event.metaKey || event.ctrlKey) return
			if (event.altKey || isEditable(event.target)) return
			const shortcut = shortcutEvent(event.key)
			const stepper =
				tile.querySelector('[data-primary] [data-quantity-stepper]') ??
				tile.querySelector('[data-quantity-stepper]')
			if (!shortcut || !stepper) return
			event.preventDefault()
			stepper.dispatchEvent(shortcut)
		}
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			if (activeTile === tile) activeTile = null
		}
	}, [])

	function activate() {
		activeTile = ref.current
	}
	function deactivate() {
		if (activeTile === ref.current) activeTile = null
	}

	useEffect(() => {
		if (!pinned) return
		function onPointerDown(event: PointerEvent) {
			if (!ref.current?.contains(event.target as Node)) setPinned(false)
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') setPinned(false)
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [pinned])

	return (
		<div
			ref={ref}
			data-pinned={pinned || undefined}
			className="group bg-muted relative aspect-[5/7] overflow-hidden rounded-lg shadow-sm"
			onPointerEnter={activate}
			onPointerLeave={deactivate}
			onFocus={activate}
		>
			<button
				type="button"
				className={cn(
					'focus-visible:ring-ring absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none',
					dimmed && washedOutBackdrop,
				)}
				aria-expanded={pinned}
				aria-label={`${alt}: show details`}
				onClick={() => setPinned((p) => !p)}
			>
				{imageUrl ? (
					<img
						src={imageUrl}
						alt=""
						loading="lazy"
						width={300}
						height={420}
						className={cn(
							'size-full object-cover transition-[filter,opacity]',
							dimmed && washedOut,
						)}
					/>
				) : (
					<span className="text-muted-foreground p-2 text-sm">{alt}</span>
				)}
			</button>
			{badge ? (
				<div
					aria-hidden
					className={cn(
						'pointer-events-none absolute top-1.5 right-1.5 flex rounded-full shadow-sm transition-opacity duration-150',
						'group-hover:opacity-0 group-has-[:focus-visible]:opacity-0 group-data-[pinned]:opacity-0',
					)}
				>
					{badge}
				</div>
			) : null}
			{/* touch screens can't hover: hint that tapping opens the details */}
			<span
				aria-hidden
				className="bg-background/80 pointer-events-none absolute right-1.5 bottom-1.5 hidden size-6 items-center justify-center rounded-full shadow-sm backdrop-blur-sm group-data-[pinned]:hidden pointer-coarse:flex"
			>
				<Icon icon={DotsHorizontal} size="sm" />
			</span>
			<div
				className={cn(
					'bg-background/80 invisible absolute inset-0 text-sm opacity-0 backdrop-blur-md transition-opacity duration-150',
					'group-hover:visible group-hover:opacity-100',
					'group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100',
					'group-data-[pinned]:visible group-data-[pinned]:opacity-100',
				)}
			>
				{/* Cards with several printings overflow the tile. The bottom
				    padding is where the content fades out, so the fade only
				    shows while there's more to scroll to. */}
				<div
					className={cn(
						'flex h-full flex-col overflow-y-auto [mask-image:linear-gradient(to_top,transparent,black_1.5rem)]',
						compact ? 'gap-1.5 p-2 pb-6' : 'gap-2 p-3 pb-6',
					)}
				>
					{overlay}
				</div>
			</div>
		</div>
	)
}

// Unowned art fades toward the page (white, or near-black in dark mode),
// keeping enough colour to recognise it. The image goes see-through over
// that backdrop.
export const washedOutBackdrop = 'bg-white dark:bg-background'
export const washedOut = 'opacity-45 saturate-75'

/**
 * How many are owned, as a pill. With a target (set completion, a deck) it
 * reads "owned / target" and turns green once the target is met.
 */
export function CountBadge({
	owned,
	target,
	title,
}: {
	owned: number
	target?: number
	title?: string
}) {
	const { canEdit, ownerName } = useCollectionAccess()
	const defaultTitle =
		target === undefined
			? `${canEdit ? 'You own' : `${ownerName} owns`} ${owned}`
			: undefined
	return (
		<span
			className={cn(
				'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
				target !== undefined && owned >= target
					? 'bg-success text-success-foreground'
					: owned > 0
						? 'bg-secondary text-secondary-foreground'
						: 'bg-muted text-muted-foreground',
			)}
			title={title ?? defaultTitle}
		>
			{target === undefined ? owned : `${owned} / ${target}`}
		</span>
	)
}

/**
 * Compact counters for a printing and its custom versions, for overlays. In a
 * collection shared with you they're plain numbers.
 */
export function OverlayCounters({
	printing,
	label,
	heading,
	primary = false,
}: {
	printing: PrintingWithCounts
	label: string
	heading?: React.ReactNode
	/** Whether keyboard shortcuts on the tile change this printing. */
	primary?: boolean
}) {
	const { canEdit } = useCollectionAccess()
	const quantity = printing.collectionEntries[0]?.quantity ?? 0
	return (
		<div className="flex flex-col gap-1" data-primary={primary || undefined}>
			{heading ? (
				<span className="truncate text-xs font-medium">{heading}</span>
			) : null}
			{canEdit ? (
				<QuantityStepper
					target={{ printingId: printing.id }}
					quantity={quantity}
					label={label}
					size="sm"
				/>
			) : (
				<StaticQuantity quantity={quantity} label={label} size="sm" />
			)}
			{printing.variants.map((variant) => (
				<div key={variant.id} className="flex flex-col gap-0.5 pl-2">
					<span
						className="text-muted-foreground truncate text-xs"
						title={variant.label}
					>
						↳ {variant.label}
					</span>
					{canEdit ? (
						<QuantityStepper
							target={{ variantId: variant.id }}
							quantity={variant.quantity}
							label={`${label} – ${variant.label}`}
							size="sm"
						/>
					) : (
						<StaticQuantity
							quantity={variant.quantity}
							label={`${label} – ${variant.label}`}
							size="sm"
						/>
					)}
				</div>
			))}
		</div>
	)
}

/**
 * A button that opens a modal with the full printing tiles, where alt arts
 * and other versions can be added, renamed and removed (or, in a collection
 * shared with you, just seen).
 */
export function VersionsButton({
	title,
	printings,
	defaultArt,
}: {
	title: string
	printings: Array<{
		printing: PrintingWithCounts
		label: string
		heading: string
	}>
	/** Lets each printing be picked as the card's art, if it has several. */
	defaultArt?: { cardId: string; printingId: string | null }
}) {
	const { canEdit } = useCollectionAccess()
	const dialogRef = useRef<HTMLDialogElement>(null)
	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="mt-auto h-7 text-xs"
				onClick={() => dialogRef.current?.showModal()}
			>
				Alt arts & versions…
			</Button>
			{/* the overlay hides itself when the pointer leaves, so the dialog is
			    kept visible explicitly while it's open */}
			<dialog
				ref={dialogRef}
				aria-label={`${title} versions`}
				className="bg-background text-foreground visible! m-auto w-[min(48rem,calc(100vw-2rem))] rounded-lg p-0 opacity-100! shadow-xl backdrop:bg-black/50"
				onClick={(e) => {
					// clicking the backdrop closes the dialog
					if (e.target === e.currentTarget) e.currentTarget.close()
				}}
			>
				<div className="flex flex-col gap-4 p-5">
					<header className="flex items-center justify-between gap-4">
						<h2 className="text-lg font-bold">{title}</h2>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Close"
							onClick={() => dialogRef.current?.close()}
						>
							<Icon icon={XClose} />
						</Button>
					</header>
					<p className="text-muted-foreground text-sm">
						{canEdit
							? 'Track alt arts, promos, foils or other languages as their own versions of a printing, each with its own count.'
							: 'Versions of this printing.'}
					</p>
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
						{printings.map(({ printing, label, heading }) => (
							<li key={printing.id}>
								<PrintingTile
									printing={printing}
									label={label}
									heading={heading}
									badge={
										canEdit && defaultArt && printings.length > 1 ? (
											<DefaultArtButton
												cardId={defaultArt.cardId}
												printingId={printing.id}
												label={label}
												isDefault={printing.id === defaultArt.printingId}
											/>
										) : null
									}
								/>
							</li>
						))}
					</ul>
				</div>
			</dialog>
		</>
	)
}
