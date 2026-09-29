/**
 * Scryfall's card image URLs follow from the printing's id, so nothing is
 * stored per size: https://scryfall.com/docs/api/images
 */
export type MtgImageSize =
	| 'small' // 146 × 204 jpg
	| 'normal' // 488 × 680 jpg
	| 'large' // 672 × 936 jpg
	| 'png' // 745 × 1040, transparent corners
	| 'art_crop' // just the illustration
	| 'border_crop' // 480 × 680, borders trimmed

export type MtgImageFace = 'front' | 'back'

export const MTG_IMAGE_HOST = 'cards.scryfall.io'
/** Set symbols (MtgSet.iconSvgUri) */
export const MTG_SET_ICON_HOST = 'svgs.scryfall.io'

/**
 * The image of a printing (MtgPrinting.id). Only printings with
 * `multiFaceImages` have a back image; for split, adventure and flip cards
 * both halves are on the front.
 */
export function mtgImageUrl(
	printingId: string,
	size: MtgImageSize = 'normal',
	face: MtgImageFace = 'front',
) {
	const extension = size === 'png' ? 'png' : 'jpg'
	return `https://${MTG_IMAGE_HOST}/${size}/${face}/${printingId[0]}/${printingId[1]}/${printingId}.${extension}`
}
