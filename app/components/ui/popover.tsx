import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '#app/utils/misc.tsx'

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
	align = 'end',
	side = 'bottom',
	sideOffset = 8,
	className,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<PopoverPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				className="isolate z-50 outline-none"
				align={align}
				side={side}
				sideOffset={sideOffset}
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 ring-foreground/10 bg-popover text-popover-foreground z-50 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg shadow-md ring-1 duration-100 outline-none',
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	)
}

function PopoverTitle({ ...props }: PopoverPrimitive.Title.Props) {
	return <PopoverPrimitive.Title data-slot="popover-title" {...props} />
}

export { Popover, PopoverContent, PopoverTitle, PopoverTrigger }
