'use client';
import { useClerk, useUser } from '@clerk/nextjs';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { clerkError } from '@/lib/clerk-error';
import { Dropdown } from './dropdown';
import { Field, Message, Modal } from './ui';

export function AccountMenu({ upward = false }: { upward?: boolean }) {
	const { user } = useUser();
	const { signOut } = useClerk();
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const name =
		user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Account';
	async function logout() {
		setBusy(true);
		setError('');
		try {
			await signOut({ redirectUrl: '/sign-in' });
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!user) return;
		const form = new FormData(event.currentTarget);
		setBusy(true);
		setError('');
		try {
			await user.update({
				firstName: String(form.get('firstName')).trim(),
				lastName: String(form.get('lastName')).trim(),
			});
			setEditing(false);
		} catch (e) {
			setError(clerkError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<Dropdown
				label='Account menu'
				upward={upward}
				align={upward ? 'left' : 'right'}
				trigger={
					<>
						<UserRound size={15} aria-hidden='true' />
						<span className='truncate'>{name}</span>
						<ChevronDown
							size={13}
							className='dropdown-chevron'
							aria-hidden='true'
						/>
					</>
				}>
				{(close) => (
					<>
						<div className='dropdown-caption'>
							{user?.primaryEmailAddress?.emailAddress}
						</div>
						<button
							className='dropdown-item'
							onClick={() => {
								close();
								setError('');
								setEditing(true);
							}}>
							<UserRound size={14} aria-hidden='true' />
							Account settings
						</button>
						<button className='dropdown-item' disabled={busy} onClick={logout}>
							<LogOut size={14} aria-hidden='true' />
							{busy ? 'Signing out…' : 'Sign out'}
						</button>
						{error && !editing && <Message error>{error}</Message>}
					</>
				)}
			</Dropdown>
			{editing && (
				<Modal title='Account settings' onClose={() => setEditing(false)}>
					<form className='form-stack' onSubmit={save}>
						<div className='form-grid'>
							<Field label='First name'>
								<input
									name='firstName'
									defaultValue={user?.firstName ?? ''}
									maxLength={100}
								/>
							</Field>
							<Field label='Last name'>
								<input
									name='lastName'
									defaultValue={user?.lastName ?? ''}
									maxLength={100}
								/>
							</Field>
						</div>
						<Field label='Email address'>
							<input
								readOnly
								value={user?.primaryEmailAddress?.emailAddress ?? ''}
							/>
						</Field>
						{error && <Message error>{error}</Message>}
						<div className='form-actions'>
							<button
								type='button'
								className='button'
								onClick={() => setEditing(false)}>
								Cancel
							</button>
							<button className='button primary' disabled={busy || !user}>
								{busy ? 'Saving…' : 'Save changes'}
							</button>
						</div>
					</form>
				</Modal>
			)}
		</>
	);
}
