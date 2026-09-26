import { Check, Loading02, XClose } from '@untitledui/icons'
import { useSpinDelay } from 'spin-delay'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './button.tsx'
import { Icon } from './icon.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

export const StatusButton = ({
	message,
	status,
	className,
	children,
	spinDelay,
	focusableWhenDisabled,
	...props
}: React.ComponentProps<typeof Button> & {
	status: 'pending' | 'success' | 'error' | 'idle'
	message?: string | null
	spinDelay?: Parameters<typeof useSpinDelay>[1]
}) => {
	const delayedPending = useSpinDelay(status === 'pending', {
		delay: 400,
		minDuration: 300,
		...spinDelay,
	})
	const companion = {
		pending: delayedPending ? (
			<span
				role="status"
				className="inline-flex size-5 items-center justify-center"
			>
				<Icon icon={Loading02} className="animate-spin" title="loading" />
			</span>
		) : null,
		success: (
			<span
				role="status"
				className="inline-flex size-5 items-center justify-center"
			>
				<Icon icon={Check} title="success" />
			</span>
		),
		error: (
			<span
				role="status"
				className="bg-destructive inline-flex size-5 items-center justify-center rounded-full"
			>
				<Icon icon={XClose} className="text-background" title="error" />
			</span>
		),
		idle: null,
	}[status]

	return (
		<Button
			// Keep focus on the button while it's disabled during submission.
			focusableWhenDisabled={focusableWhenDisabled ?? status === 'pending'}
			className={cn('flex justify-center gap-4', className)}
			{...props}
		>
			<span>{children}</span>
			{message ? (
				<Tooltip>
					<TooltipTrigger render={<span />}>{companion}</TooltipTrigger>
					<TooltipContent>{message}</TooltipContent>
				</Tooltip>
			) : (
				companion
			)}
		</Button>
	)
}
StatusButton.displayName = 'Button'
