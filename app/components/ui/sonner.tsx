import {
	AlertTriangle,
	CheckCircle,
	InfoCircle,
	Loading02,
	XCircle,
} from '@untitledui/icons'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// `theme` comes from our cookie-driven ThemeSwitch (see root.tsx) rather than
// next-themes.
const EpicToaster = ({ theme, ...props }: ToasterProps) => {
	return (
		<Sonner
			theme={theme}
			className="toaster group"
			icons={{
				success: <CheckCircle className="size-4" />,
				info: <InfoCircle className="size-4" />,
				warning: <AlertTriangle className="size-4" />,
				error: <XCircle className="size-4" />,
				loading: <Loading02 className="size-4 animate-spin" />,
			}}
			style={
				{
					'--normal-bg': 'var(--popover)',
					'--normal-text': 'var(--popover-foreground)',
					'--normal-border': 'var(--border)',
					'--border-radius': 'var(--radius)',
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: 'rounded-2xl',
				},
			}}
			{...props}
		/>
	)
}

export { EpicToaster }
