# shadcn/ui

Most components in this directory come from the
[shadcn/ui](https://ui.shadcn.com) **`base-nova`** preset: the compact Nova
style built on [Base UI](https://base-ui.com) primitives (`@base-ui/react`).
They're a starting point we own and edit, not a library we install.
`components.json` records the preset (`style: "base-nova"`, `baseColor: "zinc"`)
and our aliases.

## Re-adding a component

```sh
npx shadcn@latest add --overwrite button
```

Then re-apply our changes and review the diff:

- `cn` comes from `#app/utils/misc.tsx` (the `utils` alias).
- Icons: swap any `lucide-react` import for the matching
  [`@untitledui/icons`](../../../docs/icons.md) component (for example
  `CheckIcon` → `Check`, `ChevronRightIcon` → `ChevronRight`, `MinusIcon` →
  `Minus`). We don't depend on `lucide-react`.
- `button.tsx`: keep the `ButtonVariant` type export, and keep `buttonVariants`
  running its result through `cn` (links styled as buttons rely on it).
- `checkbox.tsx`: keep the `CheckboxProps` type export (used by `forms.tsx`).
- `input-otp.tsx`: keep `inputMode="text"`; our one-time codes allow letters.
- `sonner.tsx`: exported as `EpicToaster` and takes `theme` as a prop from our
  cookie-driven theme switch instead of reading it from `next-themes`.

The theme tokens live in `app/styles/tailwind.css`. `shadcn/tailwind.css`
provides the animations and the `data-open`/`data-checked`/... variants.

## Ours

- `icon.tsx`: `<Icon icon={Trash01}>Label</Icon>`, sizes icons to the font and
  aligns them with a label. See `docs/icons.md`.
- `brand-icons.tsx`: logos that Untitled UI doesn't ship (GitHub, passkey).
- `status-button.tsx`: a `Button` that shows pending/success/error state.

## Base UI notes

- Instead of Radix-style child slotting, use the `render` prop to swap the
  element: `<DropdownMenuItem render={<Link to="/collection" />}>`.
- Don't render links through `Button`: it gives the element button semantics.
  Style the link instead: `<Link className={buttonVariants()} to="…">`.
- A `render` element that isn't a `<button>` needs `nativeButton={false}` on
  `Button` and on menu triggers.
- Popups portal to `<body>`; the app root has `isolate` so they stack above it.
