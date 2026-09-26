import { File06, LogOut01, RefreshCw01, User01 } from '@untitledui/icons'
import { Img } from 'openimg/react'
import { Link, Form } from 'react-router'
import { cn, getUserImgSrc } from '#app/utils/misc.tsx'
import { userHasRole, useUser } from '#app/utils/user.ts'
import { buttonVariants } from './ui/button'
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from './ui/dropdown-menu'
import { Icon } from './ui/icon'

export function UserDropdown() {
	const user = useUser()
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				nativeButton={false}
				render={
					<Link
						to={`/users/${user.username}`}
						// this is for progressive enhancement
						onClick={(e) => e.preventDefault()}
						className={cn(
							buttonVariants({ variant: 'secondary' }),
							'h-10 gap-2 pl-1',
						)}
						aria-label="User menu"
						// Base UI marks non-button triggers role="button"; this is a real
						// link until hydration, so keep announcing it as one.
						role="link"
					/>
				}
			>
				<Img
					className="size-8 rounded-full object-cover"
					alt={user.name ?? user.username}
					src={getUserImgSrc(user.image?.objectKey)}
					width={256}
					height={256}
					aria-hidden="true"
				/>
				<span className="text-body-sm font-bold">
					{user.name ?? user.username}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				sideOffset={8}
				align="end"
				className="w-auto min-w-(--anchor-width)"
			>
				<DropdownMenuItem
					render={<Link prefetch="intent" to={`/users/${user.username}`} />}
				>
					<Icon className="text-body-md" icon={User01}>
						Profile
					</Icon>
				</DropdownMenuItem>
				<DropdownMenuItem render={<Link prefetch="intent" to="/collection" />}>
					<Icon className="text-body-md" icon={File06}>
						Collection
					</Icon>
				</DropdownMenuItem>
				{userHasRole(user, 'admin') ? (
					<DropdownMenuItem
						render={<Link prefetch="intent" to="/admin/nrdb-sync" />}
					>
						<Icon className="text-body-md" icon={RefreshCw01}>
							Card data sync
						</Icon>
					</DropdownMenuItem>
				) : null}
				<Form action="/logout" method="POST">
					<DropdownMenuItem
						nativeButton
						// Keep the form mounted until the submission goes out; logging
						// out navigates away anyway.
						closeOnClick={false}
						render={<button type="submit" className="w-full" />}
					>
						<Icon className="text-body-md" icon={LogOut01}>
							Logout
						</Icon>
					</DropdownMenuItem>
				</Form>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
