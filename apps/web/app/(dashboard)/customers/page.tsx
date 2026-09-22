'use client';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, ChevronRight } from 'lucide-react';
import { api, dateLabel, type Customer } from '@/lib/api';
import { EmptyState, Field, Loading, Message, Modal } from '@/components/ui';

export default function CustomersPage() {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [search, setSearch] = useState('');
	const [creating, setCreating] = useState(false);
	const query = useQuery({
		queryKey: ['customers', orgId],
		queryFn: ({ signal }) =>
			api<Customer[]>('/manage/customers', { organizationId: orgId, signal }),
		enabled: Boolean(orgId),
	});
	const create = useMutation({
		mutationFn: (body: unknown) =>
			api('/manage/customers', { method: 'POST', body, organizationId: orgId }),
		onSuccess: () => {
			setCreating(false);
			void cache.invalidateQueries({ queryKey: ['customers', orgId] });
		},
	});
	const rows =
		query.data?.filter(
			(c) =>
				!c.archivedAt &&
				`${c.name} ${c.domain ?? ''}`
					.toLowerCase()
					.includes(search.toLowerCase())
		) ?? [];
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		create.mutate({
			name: data.get('name'),
			domain: data.get('domain') || null,
		});
	}
	return (
		<>
			<div className='topbar'>
				<h1 className='topbar-title'>Customers</h1>
				<button
					className='button primary'
					onClick={() => {
						create.reset();
						setCreating(true);
					}}>
					<Plus size={14} aria-hidden='true' /> Add customer
				</button>
			</div>
			<div className='page-content customers-page'>
				<div className='list-toolbar'>
					<input
						className='search-input'
						aria-label='Search customers'
						placeholder='Search customers…'
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				{query.isPending ? (
					<Loading />
				) : query.error ? (
					<Message error>{query.error.message}</Message>
				) : rows.length ? (
					<div className='customer-table'>
						<div className='customer-table-head'>
							<span>Customer</span>
							<span>Open requests</span>
							<span>Last updated</span>
							<span />
						</div>
						{rows.map((c) => (
							<Link
								className='customer-row'
								key={c.id}
								href={`/customers/${c.id}`}>
								<div className='customer-identity'>
									<span className='avatar'>
										{c.name.slice(0, 2).toUpperCase()}
									</span>
									<span>
										<strong>{c.name}</strong>
										<small>{c.domain || 'Customer'}</small>
									</span>
								</div>
								<div>
									<span className='count-pill'>{c.openCount}</span>
									<small className='inline-muted'>
										{' '}
										/ {c.totalCount} total
									</small>
								</div>
								<span className='muted'>{dateLabel(c.updatedAt)}</span>
								<ChevronRight
									className='row-arrow'
									size={14}
									aria-hidden='true'
								/>
							</Link>
						))}
					</div>
				) : (
					<EmptyState
						title={search ? 'No matches' : 'No customers yet'}
						action={
							!search ? (
								<button
									className='button primary'
									onClick={() => setCreating(true)}>
									Add your first customer
								</button>
							) : undefined
						}>
						{search
							? 'Try a different name or domain.'
							: 'Add a customer to start tracking requests.'}
					</EmptyState>
				)}
			</div>
			{creating && (
				<Modal title='Add customer' onClose={() => setCreating(false)}>
					<form onSubmit={submit} className='form-stack'>
						<Field label='Customer name'>
							<input name='name' placeholder='Acme' required maxLength={160} />
						</Field>
						<Field
							label='Company domain'
							hint='Optional. This does not automatically grant portal access.'>
							<input name='domain' placeholder='acme.com' maxLength={253} />
						</Field>
						{create.error && <Message error>{create.error.message}</Message>}
						<div className='form-actions'>
							<button
								type='button'
								className='button'
								onClick={() => setCreating(false)}>
								Cancel
							</button>
							<button className='button primary' disabled={create.isPending}>
								{create.isPending ? 'Adding…' : 'Add customer'}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</>
	);
}
