import { useEffect, useRef, useState } from 'react'
import { QuantityStepper } from '#app/routes/resources/collection.tsx'
import { type PrintingWithCounts } from '#app/utils/collection.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { PrintingTile } from './printing-tile.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

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
	overlay,
}: {
	imageUrl: string | null
	alt: string
	/** Grey out the art, e.g. when none are owned. */
	dimmed?: boolean
	overlay: React.ReactNode
}) {
	const [pinned, setPinned] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

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
		>
			<button
				type="button"
				className="focus-visible:ring-ring absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
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
							dimmed && 'opacity-60 grayscale',
						)}
					/>
				) : (
					<span className="text-muted-foreground p-2 text-sm">{alt}</span>
				)}
			</button>
			<div
				className={cn(
					'bg-background/80 invisible absolute inset-0 flex flex-col gap-2 overflow-y-auto p-3 text-sm opacity-0 backdrop-blur-md transition-opacity duration-150',
					'group-hover:visible group-hover:opacity-100',
					'group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100',
					'group-data-[pinned]:visible group-data-[pinned]:opacity-100',
				)}
			>
				{overlay}
			</div>
		</div>
	)
}

/** Owned vs target pill, green once the target is met. */
export function CountBadge({
	owned,
	target,
	title,
}: {
	owned: number
	target: number
	title?: string
}) {
	return (
		<span
			className={cn(
				'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
				owned >= target
					? 'bg-green-600 text-white dark:bg-green-500'
					: owned > 0
						? 'bg-secondary text-secondary-foreground'
						: 'bg-muted text-muted-foreground',
			)}
			title={title}
		>
			{owned} / {target}
		</span>
	)
}

/** Compact counters for a printing and its custom versions, for overlays. */
export function OverlayCounters({
	printing,
	label,
	heading,
}: {
	printing: PrintingWithCounts
	label: string
	heading?: React.ReactNode
}) {
	return (
		<div className="flex flex-col gap-1">
			{heading ? (
				<span className="truncate text-xs font-medium">{heading}</span>
			) : null}
			<QuantityStepper
				target={{ printingId: printing.id }}
				quantity={printing.collectionEntries[0]?.quantity ?? 0}
				label={label}
				size="sm"
			/>
			{printing.variants.map((variant) => (
				<div key={variant.id} className="flex flex-col gap-0.5 pl-2">
					<span
						className="text-muted-foreground truncate text-xs"
						title={variant.label}
					>
						↳ {variant.label}
					</span>
					<QuantityStepper
						target={{ variantId: variant.id }}
						quantity={variant.quantity}
						label={`${label} – ${variant.label}`}
						size="sm"
					/>
				</div>
			))}
		</div>
	)
}

/**
 * A button that opens a modal with the full printing tiles, where alt arts
 * and other versions can be added, renamed and removed.
 */
export function VersionsButton({
	title,
	printings,
}: {
	title: string
	printings: Array<{
		printing: PrintingWithCounts
		label: string
		heading: string
	}>
}) {
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
							<Icon name="cross-1" />
						</Button>
					</header>
					<p className="text-muted-foreground text-sm">
						Track alt arts, promos, foils or other languages as their own
						versions of a printing, each with its own count.
					</p>
					<ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
						{printings.map(({ printing, label, heading }) => (
							<li key={printing.id}>
								<PrintingTile
									printing={printing}
									label={label}
									heading={heading}
								/>
							</li>
						))}
					</ul>
				</div>
			</dialog>
		</>
	)
}
