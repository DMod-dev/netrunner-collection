# Icons

Icons come from [Untitled UI Icons](https://www.untitledui.com/icons)
(`@untitledui/icons`, MIT): 1,100+ line icons shipped as individual React
components. Browse them at https://www.untitledui.com/resources/icons and import
the ones you need by their PascalCase name:

```tsx
import { Trash01 } from '@untitledui/icons'
import { Icon } from '#app/components/ui/icon.tsx'

function DeleteLabel() {
	return <Icon icon={Trash01}>Delete</Icon>
}
```

Each icon is its own module (the package is marked side-effect free), so only
the icons you import end up in the bundle.

## The `Icon` component

`app/components/ui/icon.tsx` wraps an icon component so it matches the text
around it:

- By default the icon is `1em` square, so it follows the font size. Use the
  `size` prop (`xs`–`xl`) or a `size-*` class to change it.
- Pass the label as `children` and the icon and text are aligned with a gap:
  `<Icon icon={ArrowLeft}>Back</Icon>`.
- Icons are decorative (`aria-hidden`). Pass `title` to add visually hidden text
  that describes the icon to assistive technology.

You can also render an Untitled UI icon directly. Inside the shadcn components
(`Button`, `DropdownMenuItem`, ...) a bare `<Trash01 />` is sized to `size-4`
automatically unless you give it a `size-*` class.

## Logos and other marks

Untitled UI's free set has no brand logos. `app/components/ui/brand-icons.tsx`
holds the few we need (the GitHub logo and the FIDO passkey mark) as components
with the same props, so they work with `Icon` too. Add new ones there.

## shadcn components

The shadcn CLI can't generate components for Untitled UI (`iconLibrary` in
`components.json` only supports lucide, tabler, hugeicons, phosphor and
remixicon), so it's left on `lucide`. When you add or regenerate a component,
swap its `lucide-react` imports for the Untitled UI equivalents (for example
`CheckIcon` → `Check`, `ChevronRightIcon` → `ChevronRight`) and don't install
`lucide-react`. See `app/components/ui/README.md`.
