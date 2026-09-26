import { XClose } from '@untitledui/icons'
import { useFetcher } from 'react-router'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'

export const REMOVE_SHARE_INTENT = 'remove-share'

/**
 * Deletes a share after a second click. Posts `remove-share` to the current
 * route, which both the owner's and the viewer's page handle.
 */
export function RemoveShareButton({
	shareId,
	label,
	accessibleName,
}: {
	shareId: string
	label: string
	/** Names whose share it is, since every row has the same button. */
	accessibleName: string
}) {
	const dc = useDoubleCheck()
	const fetcher = useFetcher<{ status: 'success' | 'error' }>()
	return (
		<fetcher.Form method="POST">
			<input type="hidden" name="shareId" value={shareId} />
			<StatusButton
				{...dc.getButtonProps({
					type: 'submit',
					name: 'intent',
					value: REMOVE_SHARE_INTENT,
				})}
				aria-label={dc.doubleCheck ? undefined : accessibleName}
				variant={dc.doubleCheck ? 'destructive' : 'outline'}
				size="sm"
				status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
			>
				<Icon icon={XClose}>{dc.doubleCheck ? 'Are you sure?' : label}</Icon>
			</StatusButton>
		</fetcher.Form>
	)
}
