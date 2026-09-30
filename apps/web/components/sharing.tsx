'use client';
import Link from 'next/link';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select';
import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, Loading, Message, Modal } from './ui';
type AccessKind = 'email' | 'domain' | 'regex';
type Sharing = {
	internalDomain: string | null;
	link: { id: string; token: string; path: string } | null;
	access: { id: string; email: string; kind: AccessKind; accepted: boolean }[];
};
export function SharingDialog({
	customerId,
	onClose,
}: {
	customerId: string;
	onClose: () => void;
}) {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [message, setMessage] = useState('');
	const [accessKind, setAccessKind] = useState<AccessKind>('email');
	const path = `/manage/customers/${customerId}`;
	const query = useQuery({
		queryKey: ['sharing', orgId, customerId],
		queryFn: () => api<Sharing>(`${path}/sharing`, { organizationId: orgId }),
	});
	const change = useMutation({
		mutationFn: ({
			suffix,
			method,
			body,
		}: {
			suffix: string;
			method: string;
			body?: unknown;
		}) =>
			api<{ path?: string }>(`${path}/${suffix}`, {
				method,
				body: body ?? {},
				organizationId: orgId,
			}),
		onSuccess: () => {
			void cache.invalidateQueries({
				queryKey: ['sharing', orgId, customerId],
			});
		},
	});
	const link = query.data?.link
		? `${typeof window !== 'undefined' ? window.location.origin : ''}${query.data.link.path}`
		: '';
	async function copy() {
		try {
			await navigator.clipboard.writeText(link);
			setMessage(
				'Link copied. Share it with people allowed by the addresses or rules below.'
			);
		} catch {
			setMessage('Select the link below and copy it manually.');
		}
	}
	function addAccess(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		change.mutate(
			{
				suffix: 'access',
				method: 'POST',
				body: { email: new FormData(form).get('email'), kind: accessKind },
			},
			{ onSuccess: () => form.reset() }
		);
	}
	return (
		<Modal title='Share customer portal' onClose={onClose}>
			<div className='form-stack'>
				<p className='muted'>
					Customers must sign in with a verified email that matches an address
					or rule below.
				</p>
				{query.isPending ? (
					<Loading variant='form' />
				) : query.error ? (
					<Message error>{query.error.message}</Message>
				) : (
					<>
						<div className='share-link-box'>
							<span className='field-caption'>Customer link</span>
							{link ? (
								<>
									<div className='input-action'>
										<input
											readOnly
											aria-label='Customer portal link'
											value={link}
											onFocus={(e) => e.target.select()}
										/>
										<button className='button' onClick={copy}>
											<Copy size={14} aria-hidden='true' /> Copy link
										</button>
									</div>
									<form
										className='portal-address-form'
										key={query.data!.link!.path}
										onSubmit={(event) => {
											event.preventDefault();
											const form = new FormData(event.currentTarget);
											change.mutate(
												{
													suffix: 'sharing',
													method: 'PATCH',
													body: {
														customerSlug: form.get('customerSlug'),
													},
												},
												{
													onSuccess: () =>
														setMessage(
															'Link updated. Previously shared links still work.'
														),
												}
											);
										}}>
										<div className='form-grid'>
											<Field label='Customer URL name'>
												<input
													name='customerSlug'
													required
													maxLength={60}
													pattern='[a-z0-9]+(-[a-z0-9]+)*'
													defaultValue={query.data!.link!.path.split('/')[3]}
												/>
											</Field>
										</div>
										<p className='small muted'>
											Use lowercase letters, numbers, and hyphens. This URL name
											stays the same when you rename a customer.
										</p>
										<button className='button' disabled={change.isPending}>
											Save URL
										</button>
									</form>
									<div className='link-actions'>
										<button
											disabled={change.isPending}
											onClick={() => {
												setMessage('');
												change.mutate({ suffix: 'sharing', method: 'POST' });
											}}>
											Replace link
										</button>
										<button
											disabled={change.isPending}
											onClick={() => {
												setMessage('');
												change.mutate({ suffix: 'sharing', method: 'DELETE' });
											}}>
											Disable sharing
										</button>
									</div>
									<small className='muted'>
										Replacing or disabling the link makes the current link stop
										working.
									</small>
								</>
							) : (
								<button
									className='button primary'
									disabled={change.isPending}
									onClick={() =>
										change.mutate({ suffix: 'sharing', method: 'POST' })
									}>
									Enable sharing
								</button>
							)}
						</div>
						<div>
							<h3>Portal access</h3>
							<p className='muted small'>
								Allowed people can view requests and submit new ones. Share the
								portal link with them directly; no invitation email is sent.
							</p>
							{query.data?.internalDomain && (
								<div className='access-row'>
									<span>
										@{query.data.internalDomain}
										<small>Internal domain · All customer portals</small>
									</span>
									<Link className='button small-button' href='/settings'>
										Manage in settings
									</Link>
								</div>
							)}
							{query.data?.access.map((person) => (
								<div className='access-row' key={person.id}>
									<span>
										{person.kind === 'domain'
											? `@${person.email}`
											: person.email}
										<small>
											{person.kind === 'email'
												? person.accepted
													? 'Has visited'
													: 'Not visited yet'
												: person.kind === 'domain'
													? 'Everyone at this domain'
													: 'Email regex'}
										</small>
									</span>
									<button
										className='button small-button'
										disabled={change.isPending}
										onClick={() =>
											change.mutate({
												suffix: `access/${person.id}`,
												method: 'DELETE',
											})
										}>
										Remove
									</button>
								</div>
							))}
							<form onSubmit={addAccess} className='access-form'>
								<Field label='Access type'>
									<Select
										value={accessKind}
										disabled={change.isPending}
										onValueChange={(value) => {
											setAccessKind(value as AccessKind);
											change.reset();
										}}>
										<SelectTrigger aria-label='Access type'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent position='popper'>
											<SelectItem value='email'>Email address</SelectItem>
											<SelectItem value='domain'>Email domain</SelectItem>
											<SelectItem value='regex'>Regex</SelectItem>
										</SelectContent>
									</Select>
								</Field>
								<div className='input-action'>
									<Field
										label={
											accessKind === 'email'
												? 'Email address'
												: accessKind === 'domain'
													? 'Email domain'
													: 'Email regex'
										}>
										<input
											key={accessKind}
											type={accessKind === 'email' ? 'email' : 'text'}
											maxLength={accessKind === 'regex' ? 500 : 320}
											autoCapitalize='none'
											spellCheck={false}
											name='email'
											required
											placeholder={
												accessKind === 'email'
													? 'person@acme.com'
													: accessKind === 'domain'
														? '@tembo.io'
														: '.*@tembo\\.io'
											}
										/>
									</Field>
									<button className='button' disabled={change.isPending}>
										{accessKind === 'email' ? 'Add person' : 'Add rule'}
									</button>
								</div>
								{accessKind !== 'email' && (
									<p className='muted small'>
										{accessKind === 'domain'
											? 'Allows everyone with a verified email at this exact domain, excluding subdomains.'
											: 'Matches the entire verified email, ignoring case. Use RE2 syntax without / delimiters; for example, .*@tembo\\.io'}
									</p>
								)}
							</form>
						</div>
					</>
				)}
				{change.error && <Message error>{change.error.message}</Message>}
				{message && <Message>{message}</Message>}
			</div>
		</Modal>
	);
}
