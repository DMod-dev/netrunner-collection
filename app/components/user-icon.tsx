import { User01 } from '@untitledui/icons'
import { cn } from '#app/utils/misc.tsx'

/** Stands in for a user's photo: an icon in a circle, sized by `className`. */
export function UserIcon({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				'bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full',
				className,
			)}
		>
			<User01 className="size-1/2" />
		</span>
	)
}
