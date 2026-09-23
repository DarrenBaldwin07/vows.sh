'use client';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
	ArrowLeft,
	ArrowUpDown,
	ChevronRight,
	CornerDownLeft,
	Search,
	Settings,
	Users,
	Plug,
	X,
	ExternalLink,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, statuses, statusLabels, type Status } from '@/lib/api';
import { Loading, StatusIcon } from './ui';

type SearchCustomer = {
	id: string;
	name: string;
	domain: string | null;
	archivedAt: string | null;
};
type SearchResults = {
	customers: SearchCustomer[];
	requests: {
		id: string;
		title: string;
		status: Status;
		customerId: string;
		customerName: string;
		archivedAt: string | null;
	}[];
	moreCustomers: boolean;
	moreRequests: boolean;
};
const pages = [
	{
		label: 'Customers',
		href: '/customers',
		icon: Users,
		keywords: 'customers companies',
	},
	{
		label: 'Integrations',
		href: '/integrations',
		icon: Plug,
		keywords: 'integrations slack notifications',
	},
	{
		label: 'Settings',
		href: '/settings',
		icon: Settings,
		keywords: 'settings workspace organization members invitations',
	},
];

export function CommandMenu() {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		function shortcut(event: KeyboardEvent) {
			if (
				event.key.toLowerCase() !== 'k' ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.isComposing ||
				event.repeat
			)
				return;
			if (!open && document.querySelector('dialog[open]')) return;
			event.preventDefault();
			setOpen((value) => !value);
		}
		document.addEventListener('keydown', shortcut);
		return () => document.removeEventListener('keydown', shortcut);
	}, [open]);
	return (
		<>
			<button
				className='nav-item command-trigger'
				onClick={() => setOpen(true)}
				aria-label='Search workspace'
				aria-keyshortcuts='Meta+K Control+K'>
				<Search size={14} strokeWidth={1.7} aria-hidden='true' />
				<span>Search</span>
				<kbd aria-hidden='true'>⌘K</kbd>
			</button>
			{open && <SearchDialog onClose={() => setOpen(false)} />}
		</>
	);
}

function SearchDialog({ onClose }: { onClose: () => void }) {
	const { orgId } = useAuth();
	const router = useRouter();
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const [search, setSearch] = useState('');
	const [debounced, setDebounced] = useState('');
	const [scope, setScope] = useState<SearchCustomer | null>(null);
	const [status, setStatus] = useState<Status | ''>('');
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		input.current?.focus();
		return () => element?.close();
	}, []);
	useEffect(() => {
		const element = dialog.current;
		function outside(event: MouseEvent) {
			if (!element || event.target !== element) return;
			const bounds = element.getBoundingClientRect();
			if (
				event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom
			)
				onClose();
		}
		element?.addEventListener('click', outside);
		return () => element?.removeEventListener('click', outside);
	}, [onClose]);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(search), 180);
		return () => clearTimeout(timer);
	}, [search]);
	const query = useQuery({
		queryKey: ['command-search', orgId, debounced, scope?.id, status],
		queryFn: ({ signal }) => {
			const params = new URLSearchParams({ q: debounced });
			if (scope) params.set('customerId', scope.id);
			if (status) params.set('status', status);
			return api<SearchResults>(`/manage/search?${params}`, {
				organizationId: orgId,
				signal,
			});
		},
		enabled: Boolean(orgId),
		staleTime: 0,
		retry: false,
	});
	const pending = search !== debounced || query.isPending;
	const results = !pending && !query.error ? query.data : undefined;
	const navigation =
		scope || status
			? []
			: pages.filter((page) =>
					page.keywords.includes(search.trim().toLowerCase())
				);
	function go(path: string) {
		onClose();
		router.push(path);
	}
	function chooseCustomer(customer: SearchCustomer) {
		setScope(customer);
		setSearch('');
		setDebounced('');
		setStatus('');
		input.current?.focus();
	}
	function back() {
		setScope(null);
		setSearch('');
		setDebounced('');
		setStatus('');
		input.current?.focus();
	}
	return (
		<dialog
			ref={dialog}
			className='modal command-modal'
			aria-label='Search workspace'
			onCancel={onClose}>
			<Command
				label='Search workspace'
				shouldFilter={false}
				loop
				onKeyDown={(event) => {
					if (
						event.key === 'Backspace' &&
						!search &&
						scope &&
						event.target === input.current
					) {
						event.preventDefault();
						back();
					}
				}}>
				<div className='command-input-row'>
					<Search size={16} aria-hidden='true' />
					<Command.Input
						ref={input}
						value={search}
						onValueChange={setSearch}
						maxLength={200}
						placeholder={
							scope
								? `Search ${scope.name} requests…`
								: 'Search customers, requests, or pages…'
						}
					/>
					<button
						className='icon-button'
						aria-label='Close search'
						onClick={onClose}>
						<X size={15} aria-hidden='true' />
					</button>
				</div>
				<div className='command-filters'>
					{scope ? (
						<button
							className='button small-button command-scope'
							onClick={back}>
							<ArrowLeft size={13} aria-hidden='true' />
							<span className='truncate'>{scope.name}</span>
						</button>
					) : (
						<span>Workspace</span>
					)}
					<div className='field'>
						<span className='sr-only'>Filter requests by status</span>
						<Select
							value={status || 'all'}
							onValueChange={(value) =>
								setStatus(value === 'all' ? '' : (value as Status))
							}>
							<SelectTrigger
								aria-label='Filter requests by status'
								onKeyDown={(event) => event.stopPropagation()}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent
								position='popper'
								onKeyDown={(event) => event.stopPropagation()}>
								<SelectGroup>
									<SelectItem value='all'>All statuses</SelectItem>
									{statuses.map((value) => (
										<SelectItem value={value} key={value}>
											{statusLabels[value]}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>
				</div>
				<Command.List aria-busy={pending}>
					{scope && !search.trim() && (
						<Command.Group heading='Customer'>
							<Command.Item
								value={`open-${scope.id}`}
								onSelect={() => go(`/customers/${scope.id}`)}>
								<ExternalLink size={15} aria-hidden='true' />
								<span className='truncate'>Open {scope.name}</span>
								{scope.archivedAt && <small>Archived</small>}
								<CornerDownLeft size={13} aria-hidden='true' />
							</Command.Item>
						</Command.Group>
					)}
					{navigation.length > 0 && (
						<Command.Group heading='Go to'>
							{navigation.map((page) => (
								<Command.Item
									key={page.href}
									value={page.href}
									onSelect={() => go(page.href)}>
									<page.icon size={15} aria-hidden='true' />
									<span>{page.label}</span>
								</Command.Item>
							))}
						</Command.Group>
					)}
					{pending && <Loading variant='menu' rows={3} />}
					{!pending && query.error && (
						<div className='command-message' role='alert'>
							{query.error.message}
							<button
								className='button small-button'
								onClick={() => void query.refetch()}>
								Retry
							</button>
						</div>
					)}
					{Boolean(results?.customers.length) && (
						<Command.Group heading='Customers'>
							{results!.customers.map((customer) => (
								<Command.Item
									key={customer.id}
									value={`customer-${customer.id}`}
									onSelect={() => chooseCustomer(customer)}>
									<Users size={15} aria-hidden='true' />
									<span className='command-result-text'>
										<span>{customer.name}</span>
										{customer.domain && <small>{customer.domain}</small>}
									</span>
									{customer.archivedAt && <small>Archived</small>}
									<ChevronRight size={14} aria-hidden='true' />
								</Command.Item>
							))}
						</Command.Group>
					)}
					{Boolean(results?.requests.length) && (
						<Command.Group heading='Requests'>
							{results!.requests.map((request) => (
								<Command.Item
									key={request.id}
									value={`request-${request.id}`}
									onSelect={() =>
										go(`/customers/${request.customerId}?request=${request.id}`)
									}>
									<StatusIcon status={request.status} />
									<span className='command-result-text'>
										<span>{request.title}</span>
										<small>
											{request.customerName}
											{request.archivedAt ? ' · Archived' : ''}
										</small>
									</span>
									<small>{statusLabels[request.status]}</small>
								</Command.Item>
							))}
						</Command.Group>
					)}
					{!pending &&
						!query.error &&
						!results?.customers.length &&
						!results?.requests.length &&
						!navigation.length && (
							<output className='command-message'>No matching results.</output>
						)}
					{(results?.moreCustomers || results?.moreRequests) && (
						<div className='command-message'>
							More matches available. Narrow your search
							{scope ? ' or select a status.' : ' or choose a customer.'}
						</div>
					)}
				</Command.List>
				<div className='command-footer'>
					<span>
						<ArrowUpDown size={12} aria-hidden='true' /> Navigate
					</span>
					<span>
						<CornerDownLeft size={12} aria-hidden='true' /> Select
					</span>
					<span>
						<kbd>esc</kbd> Close
					</span>
				</div>
			</Command>
		</dialog>
	);
}
