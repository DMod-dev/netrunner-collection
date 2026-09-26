import { type ComponentType, type SVGProps } from 'react'
import { cn } from '#app/utils/misc.tsx'

/**
 * Any icon component from `@untitledui/icons` (or one of ours in
 * `./brand-icons.tsx`, which follow the same props).
 */
export type IconComponent = ComponentType<
	SVGProps<SVGSVGElement> & { size?: number }
>

const sizeClassName = {
	font: 'size-[1em]',
	xs: 'size-3',
	sm: 'size-4',
	md: 'size-5',
	lg: 'size-6',
	xl: 'size-7',
} as const

type Size = keyof typeof sizeClassName

const childrenSizeClassName = {
	font: 'gap-1.5',
	xs: 'gap-1.5',
	sm: 'gap-1.5',
	md: 'gap-2',
	lg: 'gap-2',
	xl: 'gap-3',
} satisfies Record<Size, string>

/**
 * Renders an Untitled UI icon (`import { Trash01 } from '@untitledui/icons'`).
 * The icon defaults to the size of the font. To make it align vertically with
 * neighboring text, you can pass the text as a child of the icon and it will be
 * automatically aligned.
 * Alternatively, if you're not ok with the icon being to the left of the text,
 * you need to wrap the icon and text in a common parent and set the parent to
 * display "flex" (or "inline-flex") with "items-center" and a reasonable gap.
 *
 * Icons are decorative (`aria-hidden`). Pass `title` to add visually hidden
 * text describing the icon for assistive technology.
 */
export function Icon({
	icon: IconSvg,
	size = 'font',
	className,
	title,
	children,
	...props
}: Omit<SVGProps<SVGSVGElement>, 'children'> & {
	icon: IconComponent
	size?: Size
	title?: string
	children?: React.ReactNode
}) {
	if (children) {
		return (
			<span
				className={`inline-flex items-center ${childrenSizeClassName[size]}`}
			>
				<Icon
					icon={IconSvg}
					size={size}
					className={className}
					title={title}
					{...props}
				/>
				{children}
			</span>
		)
	}
	const svg = (
		<IconSvg
			{...props}
			className={cn(sizeClassName[size], 'inline self-center', className)}
		/>
	)
	if (!title) return svg
	return (
		<>
			{svg}
			<span className="sr-only">{title}</span>
		</>
	)
}
