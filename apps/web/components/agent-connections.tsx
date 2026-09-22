'use client';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, dateLabel } from '@/lib/api';
import { Field, Loading, Message } from './ui';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select';

type Key = {
	id: string;
	name: string;
	prefix: string;
	permission: 'read' | 'write';
	expiresAt: string;
	revokedAt: string | null;
	lastUsedAt: string | null;
};
export function AgentConnections() {
	const { orgId } = useAuth();
	const cache = useQueryClient();
	const [secret, setSecret] = useState('');
	const [message, setMessage] = useState('');
	const queryKey = ['agent-keys', orgId];
	const keys = useQuery({
		queryKey,
		queryFn: () => api<Key[]>('/manage/agent-keys', { organizationId: orgId }),
		enabled: Boolean(orgId),
	});
	const create = useMutation({
		gcTime: 0,
		mutationFn: (body: unknown) =>
			api<{ token: string }>('/manage/agent-keys', {
				method: 'POST',
				body,
				organizationId: orgId,
			}),
		onSuccess: (data) => {
			setSecret(data.token);
			setMessage('');
			void cache.invalidateQueries({ queryKey });
		},
	});
	const revoke = useMutation({
		mutationFn: (id: string) =>
			api(`/manage/agent-keys/${id}`, {
				method: 'DELETE',
				body: {},
				organizationId: orgId,
			}),
		onSuccess: () => {
			void cache.invalidateQueries({ queryKey });
			setMessage('API key revoked.');
		},
	});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		create.mutate({
			name: form.get('name'),
			permission: form.get('permission'),
			expiresInDays: Number(form.get('expiry')),
		});
	}
	const endpoint =
		typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`;
	async function copySecret() {
		try {
			await navigator.clipboard.writeText(secret);
			setMessage('API key copied.');
		} catch {
			setMessage('Copy the API key from the field above.');
		}
	}
	return (
		<section className='settings-section agent-connections'>
			<h2>Agent connections</h2>
			<p className='muted small'>
				Connect an MCP client or use the API with a bearer key. Each key is
				limited to this workspace and stops working if its owner loses
				membership.
			</p>
			<Field label='MCP endpoint'>
				<input readOnly value={endpoint} onFocus={(e) => e.target.select()} />
			</Field>
			<p className='small muted'>
				Header: <code>Authorization: Bearer YOUR_API_KEY</code>
			</p>
			<form className='agent-key-form' onSubmit={submit}>
				<Field label='Key name'>
					<input
						name='name'
						required
						maxLength={80}
						placeholder='My coding agent'
					/>
				</Field>
				<Field label='Access'>
					<Select name='permission' defaultValue='read'>
						<SelectTrigger aria-label='API key access'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectItem value='read'>Read only</SelectItem>
								<SelectItem value='write'>Read and write</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				<Field label='Expires in'>
					<Select name='expiry' defaultValue='90'>
						<SelectTrigger aria-label='API key expiry'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{[7, 30, 90, 365].map((days) => (
									<SelectItem key={days} value={String(days)}>
										{days} days
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				<button
					className='button primary'
					disabled={create.isPending || !orgId || Boolean(secret)}>
					Create API key
				</button>
			</form>
			{secret && (
				<div className='agent-key-secret'>
					<strong>Copy your key now. It won’t be shown again.</strong>
					<input
						aria-label='New API key'
						readOnly
						value={secret}
						onFocus={(e) => e.target.select()}
						autoComplete='off'
					/>
					<div className='heading-actions'>
						<button type='button' className='button' onClick={copySecret}>
							Copy key
						</button>
						<button
							type='button'
							className='button'
							onClick={() => {
								setSecret('');
								create.reset();
								setMessage('');
							}}>
							Done
						</button>
					</div>
				</div>
			)}
			{(create.error || revoke.error || keys.error) && (
				<Message error>
					{(create.error || revoke.error || keys.error)?.message}
				</Message>
			)}
			{message && <Message>{message}</Message>}
			{keys.isPending ? (
				<Loading />
			) : (
				<div>
					{keys.data?.length ? (
						keys.data.map((key) => (
							<div className='agent-key-row' key={key.id}>
								<div>
									<strong>{key.name}</strong>
									<p className='small muted'>
										{key.prefix}… ·{' '}
										{key.permission === 'write'
											? 'Read and write'
											: 'Read only'}{' '}
										·{' '}
										{key.revokedAt
											? 'Revoked'
											: new Date(key.expiresAt) <= new Date()
												? 'Expired'
												: `Expires ${dateLabel(key.expiresAt)}`}
									</p>
									<p className='small muted'>
										{key.lastUsedAt
											? `Last used ${dateLabel(key.lastUsedAt)}`
											: 'Not used yet'}
									</p>
								</div>
								{!key.revokedAt && (
									<button
										className='button'
										disabled={revoke.isPending}
										onClick={() => revoke.mutate(key.id)}>
										Revoke
									</button>
								)}
							</div>
						))
					) : (
						<p className='small muted'>No API keys yet.</p>
					)}
				</div>
			)}
			<details>
				<summary>Connection example</summary>
				<pre className='agent-config'>
					{JSON.stringify(
						{
							mcpServers: {
								vows: {
									url: endpoint,
									headers: { Authorization: 'Bearer YOUR_API_KEY' },
								},
							},
						},
						null,
						2
					)}
				</pre>
				<p className='small muted'>
					Writes require an idempotency key. Updates also require the record’s
					latest updatedAt. Completing requests can send configured Slack
					notifications.
				</p>
			</details>
		</section>
	);
}
