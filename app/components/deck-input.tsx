import {
	DECK_INPUT_PLACEHOLDER,
	MAX_DECK_INPUT_LENGTH,
} from '#app/utils/deck-import.ts'
import { Label } from './ui/label.tsx'
import { Textarea } from './ui/textarea.tsx'

/**
 * Where a NetrunnerDB link or a decklist is pasted, named `deck`: deck check,
 * importing a new deck, and replacing a deck's cards.
 */
export function DeckInputField({
	id,
	label = 'Deck',
	defaultValue,
	error,
	rows = 8,
}: {
	id: string
	label?: string
	defaultValue?: string
	error?: string | null
	rows?: number
}) {
	const errorId = `${id}-error`
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Textarea
				id={id}
				name="deck"
				rows={rows}
				required
				maxLength={MAX_DECK_INPUT_LENGTH}
				placeholder={DECK_INPUT_PLACEHOLDER}
				defaultValue={defaultValue}
				className="font-mono text-sm"
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
			/>
			{error ? (
				<p id={errorId} className="text-destructive text-sm">
					{error}
				</p>
			) : null}
		</div>
	)
}
