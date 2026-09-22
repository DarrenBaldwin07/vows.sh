'use client';
import { useAuth } from '@clerk/nextjs';
import { Users, Plug, Settings, ScrollText, Map } from 'lucide-react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@repo/ui/components/tooltip';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
	useRef,
	useState,
	useSyncExternalStore,
	type CSSProperties,
	type ReactNode,
} from 'react';
import { Loading } from './ui';
import { WorkspaceSwitcher } from './workspace-switcher';
import { AccountMenu } from './account-menu';
import { CommandMenu } from './command-menu';

const sidebarWidthKey = 'vows.sidebar-width';
const defaultSidebarWidth = 208;
const clampSidebarWidth = (width: number) =>
	Math.min(320, Math.max(168, width));
function getSavedSidebarWidth() {
	try {
		const saved = window.localStorage.getItem(sidebarWidthKey);
		const width = Number(saved);
		return saved?.trim() && Number.isFinite(width)
			? clampSidebarWidth(width)
			: defaultSidebarWidth;
	} catch {
		return defaultSidebarWidth;
	}
}
function subscribeSidebarWidth(onChange: () => void) {
	function changed(event: StorageEvent) {
		if (event.key === sidebarWidthKey || event.key === null) onChange();
	}
	window.addEventListener('storage', changed);
	return () => window.removeEventListener('storage', changed);
}
const getServerSidebarWidth = () => defaultSidebarWidth;

export function Shell({ children }: { children: ReactNode }) {
	const { orgId, isLoaded } = useAuth();
	const pathname = usePathname();
	const savedWidth = useSyncExternalStore(
		subscribeSidebarWidth,
		getSavedSidebarWidth,
		getServerSidebarWidth
	);
	const [adjustedWidth, setAdjustedWidth] = useState<number | null>(null);
	const sidebarWidth = adjustedWidth ?? savedWidth;
	const [resizing, setResizing] = useState(false);
	const drag = useRef({ x: 0, width: 208 });
	function resize(width: number) {
		const nextWidth = clampSidebarWidth(width);
		setAdjustedWidth(nextWidth);
		try {
			window.localStorage.setItem(sidebarWidthKey, String(nextWidth));
		} catch {
			/* Resizing still works when browser storage is unavailable. */
		}
	}
	if (!isLoaded)
		return (
			<div className='app-shell'>
				<aside className='sidebar'>
					<Loading variant='menu' rows={4} />
				</aside>
				<main className='main-content'>
					<Loading variant='page' />
				</main>
			</div>
		);
	if (!orgId)
		return (
			<main className='onboarding'>
				<div className='onboarding-card'>
					<h1>Select a workspace</h1>
					<p>Choose an existing workspace or create a new one.</p>
					<WorkspaceSwitcher />
					<div className='onboarding-account'>
						<AccountMenu />
					</div>
					<p className='small muted'>
						To view customer requests, open the link shared with you.
					</p>
				</div>
			</main>
		);
	return (
		<div
			className={`app-shell ${resizing ? 'sidebar-resizing' : ''}`}
			style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
			<aside className='sidebar' id='dashboard-sidebar'>
				<div className='workspace-switcher'>
					<WorkspaceSwitcher />
				</div>
				<nav aria-label='Workspace navigation'>
					<CommandMenu key={orgId} />
					<TooltipProvider delayDuration={250}>
						{[
							{ href: '/customers', icon: Users, label: 'Customers' },
							{ icon: ScrollText, label: 'Changelog' },
							{ icon: Map, label: 'Roadmap' },
							{ href: '/integrations', icon: Plug, label: 'Integrations' },
							{ href: '/settings', icon: Settings, label: 'Settings' },
						].map(({ href, icon: Icon, label }) =>
							href ? (
								<Link
									key={href}
									className={`nav-item ${pathname.startsWith(href) ? 'active' : ''}`}
									aria-current={pathname.startsWith(href) ? 'page' : undefined}
									href={href}>
									<Icon size={15} strokeWidth={1.7} aria-hidden='true' />
									{label}
								</Link>
							) : (
								<Tooltip key={label}>
									<TooltipTrigger asChild>
										<button
											type='button'
											className='nav-item w-full text-left max-[720px]:w-auto'
											aria-disabled='true'>
											<Icon size={15} strokeWidth={1.7} aria-hidden='true' />
											{label}
										</button>
									</TooltipTrigger>
									<TooltipContent side='right' sideOffset={2}>
										Coming soon
									</TooltipContent>
								</Tooltip>
							)
						)}
					</TooltipProvider>
				</nav>
				<div className='sidebar-bottom'>
					<AccountMenu upward />
				</div>
				{/* An adjustable separator is an interactive splitter, not a static hr. */}
				{/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
				<div
					role='separator'
					className='sidebar-resizer'
					tabIndex={0}
					aria-label='Resize sidebar'
					aria-orientation='vertical'
					aria-valuemin={168}
					aria-valuemax={320}
					aria-valuenow={sidebarWidth}
					aria-controls='dashboard-sidebar'
					title='Drag to resize. Double-click to reset.'
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						event.preventDefault();
						drag.current = { x: event.clientX, width: sidebarWidth };
						event.currentTarget.setPointerCapture(event.pointerId);
						setResizing(true);
					}}
					onPointerMove={(event) => {
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							resize(drag.current.width + event.clientX - drag.current.x);
						}
					}}
					onPointerUp={(event) => {
						if (event.currentTarget.hasPointerCapture(event.pointerId)) {
							event.currentTarget.releasePointerCapture(event.pointerId);
						}
						setResizing(false);
					}}
					onLostPointerCapture={() => setResizing(false)}
					onPointerCancel={() => setResizing(false)}
					onDoubleClick={() => resize(defaultSidebarWidth)}
					onKeyDown={(event) => {
						if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
							return;
						event.preventDefault();
						if (event.key === 'Home') resize(168);
						else if (event.key === 'End') resize(320);
						else resize(sidebarWidth + (event.key === 'ArrowRight' ? 8 : -8));
					}}
				/>
			</aside>
			<main className='main-content' key={orgId}>
				{children}
			</main>
		</div>
	);
}
