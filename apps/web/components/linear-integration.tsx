'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Field, Message } from './ui';
export type LinearConnection = {
	id: string;
	name: string;
	disconnectedAt: string | null;
	webhookConfigured: boolean;
	webhookUrl: string;
};
export function LinearIntegration({
	connection,
	organizationId,
	isAdmin,
}: {
	connection: LinearConnection | null;
	organizationId: string | null | undefined;
	isAdmin: boolean;
}) {
	const [apiKey, setApiKey] = useState('');
	const [webhookSecret, setWebhookSecret] = useState('');
	const [message, setMessage] = useState('');
	const cache = useQueryClient();
	const connected = Boolean(connection && !connection.disconnectedAt);
	const mutation = useMutation({
		mutationFn: ({ method, body }: { method: string; body?: unknown }) =>
			api('/manage/integrations/linear', {
				method,
				body: body ?? {},
				organizationId,
			}),
		onSuccess: () => {
			setApiKey('');
			setWebhookSecret('');
			void cache.invalidateQueries({
				queryKey: ['integrations', organizationId],
			});
		},
	});
	return (
		<div className='integration-card'>
			<div className='integration-heading'>
				<span className='linear-mark'>
					<Link2 size={24} aria-hidden='true' />
				</span>
				<div>
					<h2>Linear</h2>
					<p>
						{connected
							? `Connected to ${connection!.name}`
							: 'Issue status sync'}
					</p>
				</div>
				<span
					className={`connection-badge ${connected && connection!.webhookConfigured ? 'connected' : ''}`}>
					{connected
						? connection!.webhookConfigured
							? 'Connected'
							: 'Finish setup'
						: 'Not connected'}
				</span>
			</div>
			<p className='muted'>
				Paste a Linear issue link into a request. Issue status changes
				automatically update the request and its activity timeline.
			</p>
			{isAdmin ? (
				<>
					{!connected && (
						<form
							className='linear-setup-form'
							onSubmit={(event) => {
								event.preventDefault();
								mutation.mutate({ method: 'POST', body: { apiKey } });
							}}>
							<Field
								label='Linear API key'
								hint='Create a read-only key in Linear → Settings → Security & access. Grant access to the teams whose issues you want to link.'>
								<input
									type='password'
									autoComplete='new-password'
									required
									maxLength={1000}
									value={apiKey}
									onChange={(event) => setApiKey(event.target.value)}
								/>
							</Field>
							<button
								className='button primary'
								disabled={mutation.isPending || !apiKey.trim()}>
								{mutation.isPending ? 'Connecting…' : 'Connect Linear'}
							</button>
						</form>
					)}
					{connected && (
						<>
							<div className='integration-instructions'>
								<strong>
									{connection!.webhookConfigured
										? 'Status sync'
										: 'Finish automatic status sync'}
								</strong>
								<ol>
									<li>
										In Linear, open Settings → API → Webhooks and create a
										webhook for Issues.
									</li>
									<li>
										Use the URL below and select all teams you want to sync.
									</li>
									<li>
										Copy the webhook’s signing secret into the field below.
									</li>
								</ol>
								<Field label='Webhook URL'>
									<div className='input-action'>
										<input
											readOnly
											value={connection!.webhookUrl}
											onFocus={(event) => event.target.select()}
										/>
										<button
											className='button'
											type='button'
											onClick={async () => {
												try {
													await navigator.clipboard.writeText(
														connection!.webhookUrl
													);
													setMessage('Webhook URL copied.');
												} catch {
													setMessage(
														'Select and copy the webhook URL manually.'
													);
												}
											}}>
											<Copy size={14} aria-hidden='true' />
											Copy
										</button>
									</div>
								</Field>
								<form
									className='linear-setup-form'
									onSubmit={(event) => {
										event.preventDefault();
										mutation.mutate({
											method: 'PATCH',
											body: { webhookSecret },
										});
									}}>
									<Field
										label='Webhook signing secret'
										hint={
											connection!.webhookConfigured
												? 'A secret is saved. Enter a new one only if you changed it in Linear.'
												: 'This verifies that status updates come from your Linear workspace.'
										}>
										<input
											type='password'
											autoComplete='new-password'
											required
											minLength={16}
											maxLength={1000}
											value={webhookSecret}
											onChange={(event) => setWebhookSecret(event.target.value)}
										/>
									</Field>
									<button
										className='button'
										disabled={
											mutation.isPending || webhookSecret.trim().length < 16
										}>
										Save signing secret
									</button>
								</form>
							</div>
							<button
								className='button'
								disabled={mutation.isPending}
								onClick={() => mutation.mutate({ method: 'DELETE' })}>
								Disconnect Linear
							</button>
						</>
					)}
				</>
			) : (
				<Message>
					Ask a workspace admin to {connected ? 'manage' : 'connect'} Linear.
				</Message>
			)}
			<p className='muted small linear-status-mapping'>
				Backlog, Triage, and Todo → Todo; started → In progress; Review or In
				review → In review; completed → Done; canceled → Canceled. Sync runs
				from Linear to Vows only.
			</p>
			{mutation.error && <Message error>{mutation.error.message}</Message>}
			{mutation.isSuccess && <Message>Linear settings saved.</Message>}
			{message && <Message>{message}</Message>}
		</div>
	);
}
