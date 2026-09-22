'use client';
import { useAuth } from '@clerk/nextjs';
import { Users, Plug, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Loading } from './ui';
import { WorkspaceSwitcher } from './workspace-switcher';
import { AccountMenu } from './account-menu';
import { CommandMenu } from './command-menu';

export function Shell({ children }: { children: ReactNode }) {
	const { orgId, isLoaded } = useAuth();
	const pathname = usePathname();
	const [sidebarWidth, setSidebarWidth] = useState(208);
	const [resizing, setResizing] = useState(false);
	const drag = useRef({ x: 0, width: 208 });
	const resize = (width: number) =>
		setSidebarWidth(Math.min(320, Math.max(168, width)));
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
					{[
						{ href: '/customers', icon: Users, label: 'Customers' },
						{ href: '/integrations', icon: Plug, label: 'Integrations' },
						{ href: '/settings', icon: Settings, label: 'Settings' },
					].map(({ href, icon: Icon, label }) => (
						<Link
							key={href}
							className={`nav-item ${pathname.startsWith(href) ? 'active' : ''}`}
							aria-current={pathname.startsWith(href) ? 'page' : undefined}
							href={href}>
							<Icon size={15} strokeWidth={1.7} aria-hidden='true' />
							{label}
						</Link>
					))}
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
					onDoubleClick={() => setSidebarWidth(208)}
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
