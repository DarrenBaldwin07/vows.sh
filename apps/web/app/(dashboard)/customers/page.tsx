'use client';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { api, dateLabel, type Customer } from '@/lib/api';
import {
	CustomerImage,
	CustomerImageUpload,
} from '@/components/customer-image';
import { EmptyState, Field, Message, Modal } from '@/components/ui';
import {
	CustomerTableHeader,
	CustomerTableLoading,
} from '@/components/customer-table';

export default function CustomersPage() {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [search, setSearch] = useState('');
	const [imageProcessing, setImageProcessing] = useState(false);
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
			imageData: data.get('imageData') || null,
		});
	}
	return (
		<>
			<div className='topbar'>
				<h1 className='topbar-title'>Customers</h1>
				<button
					className='button primary icon-button'
					aria-label='Add customer'
					title='Add customer'
					onClick={() => {
						create.reset();
						setCreating(true);
					}}>
					<Plus size={14} aria-hidden='true' />
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
					<CustomerTableLoading />
				) : query.error ? (
					<Message error>{query.error.message}</Message>
				) : rows.length ? (
					<div className='customer-table'>
						<CustomerTableHeader />
						{rows.map((c) => (
							<Link
								className='customer-row'
								key={c.id}
								href={`/customers/${c.id}`}>
								<div className='customer-identity'>
									<CustomerImage
										id={c.id}
										name={c.name}
										imageData={c.imageData}
									/>
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
						<CustomerImageUpload onProcessingChange={setImageProcessing} />
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
							<button
								className='button primary'
								disabled={create.isPending || imageProcessing}>
								{create.isPending ? 'Adding…' : 'Add customer'}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</>
	);
}
