import { Lock01 } from '@untitledui/icons'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { type VerificationTypes } from '#app/routes/_auth/verify.tsx'
import { pageTitle } from '#app/utils/misc.tsx'
import { type BreadcrumbHandle } from '../../profile/_layout.tsx'
import { type Route } from './+types/_layout.ts'

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: <Icon icon={Lock01}>2FA</Icon>,
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => [
	{ title: pageTitle('Two-factor authentication') },
]

export const twoFAVerificationType = '2fa' satisfies VerificationTypes

export default function TwoFactorRoute() {
	return <Outlet />
}
