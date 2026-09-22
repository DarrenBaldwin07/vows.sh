'use client';
import { useAuth, useOrganization, useOrganizationList } from '@clerk/nextjs';
import {
	ChevronLeft,
	ChevronRight,
	MailPlus,
	Trash2,
	Upload,
} from 'lucide-react';
import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { Field, Loading, Message, Modal } from '@/components/ui';
import { clerkError } from '@/lib/clerk-error';
import { WorkspaceLogo } from '@/components/workspace-logo';

export default function SettingsPage() {
	const { orgId, orgRole } = useAuth();
	return (
		<>
			<div className='topbar'>
				<h1 className='topbar-title'>Settings</h1>
			</div>
			<div className='page-content'>
				{orgRole === 'org:admin' ? (
					<WorkspaceSettings key={orgId} />
				) : (
					<Message>
						Only admins can manage workspace settings and members.
					</Message>
				)}
			</div>
		</>
	);
}
function WorkspaceSettings() {
	const { userId } = useAuth();
	const { isLoaded, organization, memberships, invitations } = useOrganization({
		memberships: { pageSize: 20 },
		invitations: { pageSize: 20, status: ['pending'] },
	});
	const { userMemberships } = useOrganizationList({ userMemberships: true });
	const [busy, setBusy] = useState(false);
	const logoInput = useRef<HTMLInputElement>(null);
	const [logoAction, setLogoAction] = useState<'upload' | 'remove' | null>(
		null
	);
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const [confirmation, setConfirmation] = useState<{
		title: string;
		description: string;
		action: () => Promise<unknown>;
	} | null>(null);
	async function run(action: () => Promise<unknown>, success: string) {
		if (busy) return;
		setBusy(true);
		setError('');
		setMessage('');
		try {
			await action();
			setConfirmation(null);
			setMessage(success);
			await Promise.all([
				memberships?.revalidate?.(),
				invitations?.revalidate?.(),
				userMemberships.revalidate?.(),
			]);
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	async function changeLogo(file: File | null) {
		if (!organization || busy) return;
		setLogoAction(file ? 'upload' : 'remove');
		try {
			await run(
				() => organization.setLogo({ file }),
				file ? 'Workspace logo updated.' : 'Workspace logo removed.'
			);
		} finally {
			setLogoAction(null);
		}
	}
	function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file || busy) return;
		setError('');
		setMessage('');
		if (
			!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
				file.type
			)
		) {
			setError('Choose a PNG, JPG, WebP, or GIF image.');
			return;
		}
		if (file.size === 0 || file.size > 10 * 1024 * 1024) {
			setError('Choose an image between 1 byte and 10 MB.');
			return;
		}
		void changeLogo(file);
	}
	function rename(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!organization) return;
		const name = String(new FormData(event.currentTarget).get('name')).trim();
		if (!name) {
			setError('Enter a workspace name.');
			return;
		}
		void run(() => organization.update({ name }), 'Workspace updated.');
	}
	function invite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!organization) return;
		const form = event.currentTarget;
		const data = new FormData(form);
		void run(async () => {
			await organization.inviteMember({
				emailAddress: String(data.get('email')).trim(),
				role: String(data.get('role')),
			});
			form.reset();
		}, 'Invitation sent.');
	}
	if (!isLoaded || !organization || !memberships || !invitations)
		return <Loading variant='form' />;
	return (
		<div className='settings-content'>
			{error && <Message error>{error}</Message>}
			{message && <Message>{message}</Message>}
			<section className='settings-section'>
				<h2>General</h2>
				<div className='workspace-logo-settings'>
					<div
						className='workspace-logo-preview'
						aria-label='Current workspace logo'>
						<WorkspaceLogo organization={organization} />
					</div>
					<div className='workspace-logo-controls'>
						<span className='field-caption'>Workspace logo</span>
						<div className='workspace-logo-actions'>
							<input
								ref={logoInput}
								type='file'
								accept='image/png,image/jpeg,image/webp,image/gif'
								aria-label='Upload workspace logo'
								hidden
								disabled={busy}
								onChange={uploadLogo}
							/>
							<button
								type='button'
								className='button'
								disabled={busy}
								onClick={() => logoInput.current?.click()}>
								<Upload size={13} aria-hidden='true' />
								{logoAction === 'upload'
									? 'Uploading…'
									: organization.hasImage
										? 'Change logo'
										: 'Upload logo'}
							</button>
							{organization.hasImage && (
								<button
									type='button'
									className='button'
									disabled={busy}
									onClick={() => void changeLogo(null)}>
									{logoAction === 'remove' ? 'Removing…' : 'Remove logo'}
								</button>
							)}
						</div>
						<p>PNG, JPG, WebP, or GIF. Up to 10 MB.</p>
					</div>
				</div>
				<form onSubmit={rename} className='settings-name-form'>
					<Field label='Workspace name'>
						<input
							key={organization.name}
							name='name'
							defaultValue={organization.name}
							required
							maxLength={160}
						/>
					</Field>
					<button className='button' disabled={busy}>
						Save changes
					</button>
				</form>
			</section>
			<section className='settings-section'>
				<h2>Invite a member</h2>
				<form onSubmit={invite} className='invite-form'>
					<Field label='Email address'>
						<input
							type='email'
							name='email'
							placeholder='name@company.com'
							required
						/>
					</Field>
					<Field label='Role'>
						<select name='role' defaultValue='org:member'>
							<option value='org:member'>Member</option>
							<option value='org:admin'>Admin</option>
						</select>
					</Field>
					<button className='button primary' disabled={busy}>
						<MailPlus size={14} aria-hidden='true' />
						Send invitation
					</button>
				</form>
			</section>
			<section className='settings-section'>
				<h2>
					Members{' '}
					<span className='heading-count'>{memberships.count ?? 0}</span>
				</h2>
				{memberships.isLoading ? (
					<Loading rows={3} />
				) : memberships.error ? (
					<Message error>{clerkError(memberships.error)}</Message>
				) : (
					<>
						<div className='member-list'>
							{memberships.data?.map((member) => {
								const person = member.publicUserData;
								const name =
									[person?.firstName, person?.lastName]
										.filter(Boolean)
										.join(' ') ||
									person?.identifier ||
									'Member';
								const isSelf = person?.userId === userId;
								return (
									<div className='member-row' key={member.id}>
										<div className='member-identity'>
											<strong>
												{name}
												{isSelf && <span className='muted'> (you)</span>}
											</strong>
											<span>{person?.identifier}</span>
										</div>
										<select
											aria-label={`Role for ${name}`}
											value={member.role}
											disabled={busy || isSelf}
											onChange={(e) => {
												const role = e.target.value;
												void run(
													() => member.update({ role }),
													'Member role updated.'
												);
											}}>
											{!['org:admin', 'org:member'].includes(member.role) && (
												<option value={member.role}>{member.roleName}</option>
											)}
											<option value='org:member'>Member</option>
											<option value='org:admin'>Admin</option>
										</select>
										<button
											className='icon-button'
											aria-label={`Remove ${name}`}
											disabled={busy || isSelf}
											onClick={() =>
												setConfirmation({
													title: 'Remove member',
													description: `${name} will lose access to this workspace.`,
													action: () => member.destroy(),
												})
											}>
											<Trash2 size={15} aria-hidden='true' />
										</button>
									</div>
								);
							})}
						</div>
						<Pagination
							page={memberships.page}
							next={memberships.fetchNext}
							previous={memberships.fetchPrevious}
							hasNext={memberships.hasNextPage}
							hasPrevious={memberships.hasPreviousPage}
							busy={busy || memberships.isFetching}
						/>
					</>
				)}
			</section>
			<section className='settings-section'>
				<h2>Pending invitations</h2>
				{invitations.isLoading ? (
					<Loading rows={3} />
				) : invitations.error ? (
					<Message error>{clerkError(invitations.error)}</Message>
				) : (
					<>
						{!invitations.data?.length && (
							<p className='muted small'>No pending invitations.</p>
						)}
						{invitations.data?.map((invitation) => (
							<div className='member-row' key={invitation.id}>
								<div className='member-identity'>
									<strong>{invitation.emailAddress}</strong>
									<span>
										{invitation.role === 'org:admin' ? 'Admin' : 'Member'}
									</span>
								</div>
								<button
									className='button small-button'
									disabled={busy}
									onClick={() =>
										setConfirmation({
											title: 'Revoke invitation',
											description: `${invitation.emailAddress} will no longer be able to join using this invitation.`,
											action: () => invitation.revoke(),
										})
									}>
									Revoke
								</button>
							</div>
						))}
						<Pagination
							page={invitations.page}
							next={invitations.fetchNext}
							previous={invitations.fetchPrevious}
							hasNext={invitations.hasNextPage}
							hasPrevious={invitations.hasPreviousPage}
							busy={busy || invitations.isFetching}
						/>
					</>
				)}
			</section>
			{confirmation && (
				<Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
					<div className='form-stack'>
						<p>{confirmation.description}</p>
						{error && <Message error>{error}</Message>}
						<div className='form-actions'>
							<button className='button' onClick={() => setConfirmation(null)}>
								Cancel
							</button>
							<button
								className='button primary'
								disabled={busy}
								onClick={() =>
									void run(confirmation.action, 'Access updated.')
								}>
								{busy ? 'Updating…' : confirmation.title}
							</button>
						</div>
					</div>
				</Modal>
			)}
		</div>
	);
}
function Pagination({
	page,
	next,
	previous,
	hasNext,
	hasPrevious,
	busy,
}: {
	page?: number;
	next?: () => void;
	previous?: () => void;
	hasNext?: boolean;
	hasPrevious?: boolean;
	busy?: boolean;
}) {
	if (!hasNext && !hasPrevious) return null;
	return (
		<div className='pagination'>
			<button
				className='button small-button'
				disabled={busy || !hasPrevious}
				onClick={previous}>
				<ChevronLeft size={14} aria-hidden='true' />
				Previous
			</button>
			<span>Page {page}</span>
			<button
				className='button small-button'
				disabled={busy || !hasNext}
				onClick={next}>
				Next
				<ChevronRight size={14} aria-hidden='true' />
			</button>
		</div>
	);
}
