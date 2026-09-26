import { ChevronDown, XClose } from '@untitledui/icons'
import { useEffect, useId, useRef } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import {
	type clientAction as deckClientAction,
	DECK_ACTION_PATH,
} from '#app/routes/resources/deck.tsx'
import { deckSettingsFetcherKey } from '#app/utils/deck.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { DeckInputField } from './deck-input.tsx'
import { Button } from './ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'

async function copyText(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text)
	} catch {
		toast.error('Couldn’t copy to the clipboard')
		return
	}
	toast.success(done)
}

/**
 * The deck as text: copied, or downloaded as a file. On a filled deck, also
 * the copies the collection doesn't have, as a shopping list.
 */
export function DeckExportMenu({
	deckId,
	text,
	missing,
}: {
	deckId: string
	/** the decklist, as `toNrdbText` writes it */
	text: string
	/** "2x Card" lines for the copies not owned; null if there are none */
	missing: string | null
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" />}>
				Export
				<Icon icon={ChevronDown} size="sm" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto">
				<DropdownMenuItem
					onClick={() => void copyText(text, 'Copied the decklist')}
				>
					Copy as text
				</DropdownMenuItem>
				<DropdownMenuItem
					render={
						<a
							href={`/resources/deck-export?deckId=${encodeURIComponent(deckId)}`}
							download
						/>
					}
				>
					Download .txt
				</DropdownMenuItem>
				{missing ? (
					<DropdownMenuItem
						onClick={() =>
							void copyText(missing, 'Copied the cards you’re missing')
						}
					>
						Copy missing list
					</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/**
 * Replace the deck's cards with a pasted list or NetrunnerDB link, after a
 * second click to confirm. A filled deck is filled again.
 */
export function ImportDeckDialog({ deckId }: { deckId: string }) {
	const id = useId()
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	const fetcher = useFetcher<typeof deckClientAction>({
		key: deckSettingsFetcherKey(deckId, 'import'),
	})
	const dc = useDoubleCheck()
	const busy = fetcher.state !== 'idle'
	const error =
		fetcher.state === 'idle' && fetcher.data && !fetcher.data.ok
			? fetcher.data.error
			: null

	// done: the toast says what happened
	useEffect(() => {
		if (fetcher.state !== 'idle' || !fetcher.data?.ok) return
		dialogRef.current?.close()
		formRef.current?.reset()
	}, [fetcher.state, fetcher.data])

	return (
		<>
			<Button
				type="button"
				variant="outline"
				disabled={busy}
				onClick={() => dialogRef.current?.showModal()}
			>
				{busy ? 'Importing…' : 'Import'}
			</Button>
			<dialog
				ref={dialogRef}
				aria-labelledby={`${id}-title`}
				className="bg-background text-foreground m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-black/50"
				onClick={(e) => {
					// clicking the backdrop closes the dialog
					if (e.target === e.currentTarget) e.currentTarget.close()
				}}
			>
				<fetcher.Form
					ref={formRef}
					method="POST"
					action={DECK_ACTION_PATH}
					className="flex flex-col gap-4 p-5"
				>
					<header className="flex items-center justify-between gap-4">
						<h2 id={`${id}-title`} className="text-lg font-bold">
							Import into this deck
						</h2>
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
						The list replaces every card in the deck, and its identity if it has
						one. Cards whose count doesn’t change keep what they took from your
						collection.
					</p>
					<input type="hidden" name="intent" value="import" />
					<input type="hidden" name="deckId" value={deckId} />
					<DeckInputField id={`${id}-deck`} error={error} rows={10} />
					<StatusButton
						variant={dc.doubleCheck ? 'destructive' : 'default'}
						status={busy ? 'pending' : 'idle'}
						disabled={busy}
						className="self-end"
						{...dc.getButtonProps({ type: 'submit' })}
					>
						{dc.doubleCheck ? 'Replace all cards?' : 'Replace cards'}
					</StatusButton>
				</fetcher.Form>
			</dialog>
		</>
	)
}
