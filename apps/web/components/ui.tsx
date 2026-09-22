'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import {
	Circle,
	CircleDashed,
	CircleDot,
	CircleCheck,
	CircleX,
	Inbox,
	X,
} from 'lucide-react';
import { statusLabels, type Status } from '@/lib/api';

const statusIcons = {
	todo: Circle,
	in_progress: CircleDot,
	in_review: CircleDashed,
	done: CircleCheck,
	canceled: CircleX,
};
export function StatusIcon({ status }: { status: Status }) {
	const Icon = statusIcons[status];
	return <Icon size={13} strokeWidth={1.7} aria-hidden='true' />;
}
export function StatusBadge({ status }: { status: Status }) {
	return (
		<span className={`status-badge status-${status}`}>
			<StatusIcon status={status} />
			{statusLabels[status]}
		</span>
	);
}
export function Message({
	children,
	error = false,
}: {
	children: ReactNode;
	error?: boolean;
}) {
	return (
		<div
			className={error ? 'notice notice-error' : 'notice'}
			role={error ? 'alert' : 'status'}>
			{children}
		</div>
	);
}
export function EmptyState({
	title,
	children,
	action,
}: {
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className='empty-state'>
			<span className='empty-mark'>
				<Inbox size={22} strokeWidth={1.5} aria-hidden='true' />
			</span>
			<h2>{title}</h2>
			<div className='empty-description'>{children}</div>
			{action}
		</div>
	);
}
export function Modal({
	title,
	children,
	onClose,
	wide = false,
}: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	wide?: boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog
			ref={ref}
			className={`modal ${wide ? 'modal-wide' : ''}`}
			onCancel={onClose}>
			<div className='modal-heading'>
				<h2>{title}</h2>
				<button
					className='icon-button'
					onClick={onClose}
					aria-label='Close dialog'>
					<X size={16} aria-hidden='true' />
				</button>
			</div>
			{children}
		</dialog>
	);
}
export function Field({
	label,
	children,
	hint,
}: {
	label: string;
	children: ReactNode;
	hint?: string;
}) {
	return (
		<label className='field'>
			<span>{label}</span>
			{children}
			{hint && <small>{hint}</small>}
		</label>
	);
}
export function Skeleton({ className = '' }: { className?: string }) {
	return <span className={`skeleton ${className}`} aria-hidden='true' />;
}
export function Loading({
	variant = 'list',
	rows = 4,
}: {
	variant?: 'list' | 'form' | 'card' | 'menu' | 'page';
	rows?: number;
}) {
	const list = (
		<div className='skeleton-rows' aria-hidden='true'>
			{Array.from({ length: rows }, (_, index) => (
				<div className='skeleton-row' key={index}>
					<Skeleton className='skeleton-square' />
					<div className='skeleton-text'>
						<Skeleton
							className={index % 2 ? 'skeleton-medium' : 'skeleton-long'}
						/>
						<Skeleton className='skeleton-short skeleton-fine' />
					</div>
					<Skeleton className='skeleton-meta' />
				</div>
			))}
		</div>
	);
	return (
		<output
			className={`loading-skeleton loading-skeleton-${variant}`}
			aria-busy='true'
			aria-label='Loading'>
			<span className='sr-only'>Loading…</span>
			{variant === 'page' ? (
				<>
					<div className='skeleton-topbar'>
						<Skeleton className='skeleton-medium' />
						<Skeleton className='skeleton-button' />
					</div>
					<div className='page-content'>
						<div className='skeleton-toolbar'>
							<Skeleton className='skeleton-short' />
							<Skeleton className='skeleton-input' />
						</div>
						{list}
					</div>
				</>
			) : variant === 'form' ? (
				<div className='skeleton-form' aria-hidden='true'>
					{Array.from({ length: 3 }, (_, index) => (
						<div className='skeleton-field' key={index}>
							<Skeleton className='skeleton-short skeleton-fine' />
							<Skeleton
								className={index === 2 ? 'skeleton-textarea' : 'skeleton-input'}
							/>
						</div>
					))}
					<div className='skeleton-actions'>
						<Skeleton className='skeleton-button' />
						<Skeleton className='skeleton-button' />
					</div>
				</div>
			) : variant === 'card' ? (
				<div className='skeleton-card' aria-hidden='true'>
					<div className='skeleton-row'>
						<Skeleton className='skeleton-square' />
						<div className='skeleton-text'>
							<Skeleton className='skeleton-medium' />
							<Skeleton className='skeleton-long skeleton-fine' />
						</div>
					</div>
					<Skeleton className='skeleton-long' />
					<Skeleton className='skeleton-medium' />
					<Skeleton className='skeleton-button' />
				</div>
			) : (
				list
			)}
		</output>
	);
}
