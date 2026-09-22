'use client';
import { Suspense, use, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Link2, ChevronRight } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	api,
	dateLabel,
	statuses,
	statusLabels,
	type Customer,
	type Status,
	type VowRequest,
} from '@/lib/api';
import {
	EmptyState,
	Field,
	Loading,
	Message,
	Modal,
	StatusIcon,
} from '@/components/ui';
import { SharingDialog } from '@/components/sharing';
import { InitialBadge } from '@/components/initial-badge';
import { RequestEditor } from '@/components/request-editor';

export default function CustomerPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	return (
		<Suspense fallback={<Loading variant='page' />}>
			<CustomerRoute id={id} />
		</Suspense>
	);
}
function CustomerRoute({ id }: { id: string }) {
	const params = useSearchParams();
	const initialRequest = params.get('request') ?? undefined;
	return (
		<CustomerContent
			key={`${id}:${initialRequest ?? ''}`}
			id={id}
			initialRequest={initialRequest}
		/>
	);
}
function CustomerContent({
	id,
	initialRequest,
}: {
	id: string;
	initialRequest?: string;
}) {
	const router = useRouter();
	const { orgId, orgRole } = useAuth();
	const cache = useQueryClient();
	const [sharing, setSharing] = useState(false);
	const [settings, setSettings] = useState(false);
	const [editor, setEditor] = useState<string | null | undefined>(
		initialRequest
	);
	const [search, setSearch] = useState('');
	const query = useQuery({
		queryKey: ['customer', orgId, id],
		queryFn: ({ signal }) =>
			api<{ customer: Customer; requests: VowRequest[] }>(
				`/manage/customers/${id}`,
				{ organizationId: orgId, signal }
			),
		enabled: Boolean(orgId),
	});
	function refresh() {
		void cache.invalidateQueries({ queryKey: ['customer', orgId, id] });
		void cache.invalidateQueries({ queryKey: ['customers', orgId] });
	}
	const status = useMutation({
		mutationFn: ({ requestId, value }: { requestId: string; value: Status }) =>
			api(`/manage/requests/${requestId}/status`, {
				method: 'PATCH',
				body: { status: value },
				organizationId: orgId,
			}),
		onSuccess: refresh,
	});
	const update = useMutation({
		mutationFn: (body: unknown) =>
			api(`/manage/customers/${id}`, {
				method: 'PATCH',
				body,
				organizationId: orgId,
			}),
		onSuccess: () => {
			refresh();
			setSettings(false);
		},
	});
	if (query.isPending) return <Loading variant='page' />;
	if (query.error)
		return (
			<div className='page-content'>
				<Message error>{query.error.message}</Message>
				<Link href='/customers' className='text-button'>
					Back to customers
				</Link>
			</div>
		);
	const { customer, requests } = query.data;
	const rows = requests.filter((r) =>
		r.title.toLowerCase().includes(search.toLowerCase())
	);
	function saveCustomer(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		update.mutate({
			name: form.get('name'),
			domain: form.get('domain') || null,
		});
	}
	return (
		<>
			<div className='topbar customer-topbar'>
				<h1 className='breadcrumbs topbar-title'>
					<Link href='/customers'>Customers</Link>
					<ChevronRight
						className='breadcrumb-divider'
						size={16}
						strokeWidth={2.25}
						aria-hidden='true'
					/>
					<span
						className='breadcrumb-current'
						aria-current='page'
						title={customer.name}>
						<InitialBadge id={customer.id} name={customer.name} />
						<span className='truncate'>{customer.name}</span>
					</span>
				</h1>
				<div className='heading-actions'>
					<button
						className='text-button'
						onClick={() => {
							update.reset();
							setSettings(true);
						}}>
						Customer settings
					</button>
					{orgRole === 'org:admin' && (
						<button className='button' onClick={() => setSharing(true)}>
							<Link2 size={14} aria-hidden='true' /> Share portal
						</button>
					)}
					<button
						className='button primary'
						disabled={Boolean(customer.archivedAt)}
						onClick={() => setEditor(null)}>
						<Plus size={14} aria-hidden='true' /> New request
					</button>
				</div>
			</div>
			<div className='page-content'>
				{initialRequest &&
					!requests.some((request) => request.id === initialRequest) && (
						<Message error>
							This request is not available for this customer.
						</Message>
					)}
				{customer.archivedAt && (
					<Message>
						This customer is archived. Their portal is unavailable.{' '}
						<button
							className='text-button'
							onClick={() => update.mutate({ archived: false })}>
							Restore customer
						</button>
					</Message>
				)}
				<div className='list-toolbar'>
					<span className='section-tab'>
						Requests <span className='heading-count'>{requests.length}</span>
					</span>
					<input
						className='search-input'
						aria-label='Search requests'
						placeholder='Search requests…'
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				{status.error && <Message error>{status.error.message}</Message>}
				{update.error && <Message error>{update.error.message}</Message>}
				{rows.length ? (
					<div className='request-groups'>
						{statuses.map((s) => {
							const group = rows.filter((r) => r.status === s);
							return (
								group.length > 0 && (
									<section className='request-group' key={s}>
										<div className={`group-heading status-${s}`}>
											<StatusIcon status={s} />
											{statusLabels[s]}
											<span className='group-count'>{group.length}</span>
										</div>
										{group.map((r) => (
											<div className='request-row' key={r.id}>
												<select
													aria-label={`Status for ${r.title}`}
													className={`inline-status status-${r.status}`}
													value={r.status}
													disabled={
														status.isPending || Boolean(customer.archivedAt)
													}
													onChange={(e) =>
														status.mutate({
															requestId: r.id,
															value: e.target.value as Status,
														})
													}>
													{statuses.map((option) => (
														<option key={option} value={option}>
															{statusLabels[option]}
														</option>
													))}
												</select>
												<button
													className='request-title-button'
													onClick={() => setEditor(r.id)}>
													<strong>{r.title}</strong>
													{r.description && <span>{r.description}</span>}
												</button>
												<time>{dateLabel(r.updatedAt)}</time>
												<button
													className='icon-button'
													aria-label={`Open ${r.title}`}
													onClick={() => setEditor(r.id)}>
													<ChevronRight size={14} aria-hidden='true' />
												</button>
											</div>
										))}
									</section>
								)
							);
						})}
					</div>
				) : (
					<EmptyState
						title={search ? 'No matching requests' : 'No requests yet'}
						action={
							!search && !customer.archivedAt ? (
								<button
									className='button primary'
									onClick={() => setEditor(null)}>
									Create the first request
								</button>
							) : undefined
						}>
						{search
							? 'Try another search.'
							: 'Add a request for this customer.'}
					</EmptyState>
				)}
				<div className='list-footer'>
					<span>
						{requests.filter((r) => r.status === 'done').length} of{' '}
						{requests.length} completed
					</span>
				</div>
			</div>
			{sharing && (
				<SharingDialog customerId={id} onClose={() => setSharing(false)} />
			)}
			{editor !== undefined &&
				(editor === null ||
					requests.some((request) => request.id === editor)) && (
					<RequestEditor
						customerId={id}
						requestId={editor}
						onClose={() => {
							setEditor(undefined);
							if (initialRequest)
								router.replace(`/customers/${id}`, { scroll: false });
						}}
					/>
				)}
			{settings && (
				<Modal title='Customer settings' onClose={() => setSettings(false)}>
					<form className='form-stack' onSubmit={saveCustomer}>
						<Field label='Customer name'>
							<input
								name='name'
								required
								defaultValue={customer.name}
								maxLength={160}
							/>
						</Field>
						<Field label='Company domain'>
							<input
								name='domain'
								defaultValue={customer.domain ?? ''}
								maxLength={253}
							/>
						</Field>
						{update.error && <Message error>{update.error.message}</Message>}
						<div className='form-actions'>
							<button
								type='button'
								className='button'
								disabled={update.isPending}
								onClick={() =>
									update.mutate({ archived: !customer.archivedAt })
								}>
								{customer.archivedAt ? 'Restore customer' : 'Archive customer'}
							</button>
							<button className='button primary' disabled={update.isPending}>
								Save changes
							</button>
						</div>
						<p className='small muted'>
							Archiving hides the customer from the active list and disables
							their portal. Their requests are preserved.
						</p>
					</form>
				</Modal>
			)}
		</>
	);
}
