import { useState } from 'react'
import {
	AddVariantForm,
	DeleteVariantButton,
	QuantityStepper,
} from '#app/routes/resources/collection.tsx'
import { type PrintingWithCounts } from '#app/utils/collection.server.ts'

/**
 * One NRDB printing with its image, the user's plain-copy counter and any
 * custom versions (alt arts, promos...) they've added.
 */
export function PrintingTile({
	printing,
	label,
	heading,
	badge,
}: {
	printing: PrintingWithCounts
	/** Names the printing for screen readers, e.g. "Corroder (System Gateway)". */
	label: string
	heading: React.ReactNode
	badge?: React.ReactNode
}) {
	const [addingVariant, setAddingVariant] = useState(false)
	const quantity = printing.collectionEntries[0]?.quantity ?? 0

	return (
		<div className="bg-muted/50 flex h-full flex-col gap-2 rounded-md p-2">
			<div className="flex gap-2">
				{printing.imageSmall ? (
					<a
						href={printing.imageLarge ?? printing.imageSmall}
						target="_blank"
						rel="noreferrer"
						className="shrink-0"
					>
						<img
							src={printing.imageSmall}
							alt={label}
							loading="lazy"
							width={60}
							height={84}
							className="h-[84px] w-[60px] rounded object-cover"
						/>
					</a>
				) : null}
				<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-xs">
					<span className="font-semibold">{heading}</span>
					<span className="text-muted-foreground">
						#{printing.position}
						{printing.illustrator ? ` · ${printing.illustrator}` : ''}
					</span>
					{badge}
				</div>
			</div>
			<QuantityStepper
				target={{ printingId: printing.id }}
				quantity={quantity}
				label={label}
			/>
			{printing.variants.length ? (
				<ul className="border-border flex flex-col gap-1 border-t pt-2">
					{printing.variants.map((variant) => (
						<li key={variant.id} className="flex flex-col gap-1">
							<div className="flex items-center justify-between gap-1">
								<span
									className="truncate text-xs font-medium"
									title={variant.label}
								>
									{variant.label}
								</span>
								<DeleteVariantButton
									variantId={variant.id}
									label={variant.label}
								/>
							</div>
							<QuantityStepper
								target={{ variantId: variant.id }}
								quantity={variant.quantity}
								label={`${label} – ${variant.label}`}
								size="sm"
							/>
						</li>
					))}
				</ul>
			) : null}
			{addingVariant ? (
				<AddVariantForm
					printingId={printing.id}
					onDone={() => setAddingVariant(false)}
				/>
			) : (
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground mt-auto self-start text-xs underline"
					onClick={() => setAddingVariant(true)}
				>
					+ Alt art / other version
				</button>
			)}
		</div>
	)
}

const FACTION_COLORS: Record<string, string> = {
	anarch: '#e46d19',
	criminal: '#3b6bd8',
	shaper: '#3fa63f',
	haas_bioroid: '#8a3aa6',
	jinteki: '#c7303b',
	nbn: '#e6b800',
	weyland_consortium: '#2d6d54',
	adam: '#b4a153',
	apex: '#9e3a3a',
	sunny_lebeau: '#6d6d6d',
	neutral_corp: '#8a8a8a',
	neutral_runner: '#8a8a8a',
}

export function FactionDot({ factionId }: { factionId: string }) {
	return (
		<span
			aria-hidden
			className="inline-block size-2.5 rounded-full align-middle"
			style={{ backgroundColor: FACTION_COLORS[factionId] ?? '#8a8a8a' }}
		/>
	)
}
