import { Link, NavLink, useSearchParams } from 'react-router'
import { cn } from '#app/utils/misc.tsx'

export function CollectionNav() {
	const tabClass = ({ isActive }: { isActive: boolean }) =>
		cn(
			'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
			isActive
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground',
		)
	return (
		<nav
			aria-label="Collection views"
			className="bg-muted inline-flex gap-1 self-start rounded-lg p-1"
		>
			<NavLink to="/collection" end className={tabClass}>
				Cards
			</NavLink>
			<NavLink to="/collection/sets" className={tabClass}>
				Sets
			</NavLink>
		</nav>
	)
}

export function ProgressBar({
	have,
	need,
	label,
	className,
}: {
	have: number
	need: number
	label: string
	className?: string
}) {
	const percent = need === 0 ? 0 : Math.round((have / need) * 100)
	const complete = need > 0 && have >= need
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={need}
			aria-valuenow={have}
			aria-valuetext={`${have} of ${need} (${percent}%)`}
			className={cn(
				'bg-muted h-2 w-full overflow-hidden rounded-full',
				className,
			)}
		>
			<div
				className={cn(
					'h-full rounded-full transition-[width]',
					complete ? 'bg-green-600 dark:bg-green-500' : 'bg-primary',
				)}
				style={{ width: `${percent}%` }}
			/>
		</div>
	)
}

export function formatPercent(have: number, need: number) {
	if (need === 0) return '–'
	const percent = (have / need) * 100
	// don't round an almost-complete set up to 100%
	return `${percent > 99 && have < need ? 99 : Math.round(percent)}%`
}

const TARGETS = [
	{
		id: 'product',
		label: 'As printed',
		description: 'Copies of each printing that come in the product',
	},
	{
		id: 'playset',
		label: 'Playset',
		description: 'A full deck limit of each card, from any printing',
	},
] as const

/** Switch between "product" and "playset" completion, kept in the URL. */
export function TargetToggle({ target }: { target: 'product' | 'playset' }) {
	const [searchParams] = useSearchParams()
	function linkFor(id: string) {
		const params = new URLSearchParams(searchParams)
		if (id === 'product') params.delete('target')
		else params.set('target', id)
		const query = params.toString()
		return { search: query ? `?${query}` : '' }
	}
	return (
		<div className="flex flex-col gap-1">
			<div
				role="group"
				aria-label="Completion target"
				className="bg-muted inline-flex gap-1 self-start rounded-lg p-1"
			>
				{TARGETS.map((t) => (
					<Link
						key={t.id}
						to={linkFor(t.id)}
						replace
						preventScrollReset
						aria-current={target === t.id ? 'true' : undefined}
						title={t.description}
						className={cn(
							'rounded-md px-3 py-1 text-sm font-medium transition-colors',
							target === t.id
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						{t.label}
					</Link>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				{TARGETS.find((t) => t.id === target)?.description}
			</p>
		</div>
	)
}

const SET_TYPE_LABELS: Record<string, string> = {
	core: 'Core set',
	deluxe: 'Deluxe',
	data_pack: 'Data pack',
	booster_pack: 'Booster pack',
	expansion: 'Expansion',
	campaign: 'Campaign',
	promo: 'Promo',
	draft: 'Draft',
}

export function formatSetType(setTypeId: string) {
	return SET_TYPE_LABELS[setTypeId] ?? setTypeId.replace(/_/g, ' ')
}
