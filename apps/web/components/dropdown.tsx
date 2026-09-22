'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dropdown({
	label,
	trigger,
	children,
	align = 'left',
	upward = false,
}: {
	label: string;
	trigger: ReactNode;
	children: (close: () => void) => ReactNode;
	align?: 'left' | 'right';
	upward?: boolean;
}) {
	const ref = useRef<HTMLDetailsElement>(null);
	const [open, setOpen] = useState(false);
	function close() {
		setOpen(false);
	}
	useEffect(() => {
		function outside(event: PointerEvent) {
			if (event.target instanceof Node && !ref.current?.contains(event.target))
				close();
		}
		function escape(event: KeyboardEvent) {
			if (event.key === 'Escape' && ref.current?.open) {
				close();
				ref.current.querySelector('summary')?.focus();
			}
		}
		document.addEventListener('pointerdown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, []);
	return (
		<details
			ref={ref}
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			className={`dropdown ${upward ? 'dropdown-up' : ''}`}>
			<summary className='dropdown-trigger' aria-label={label}>
				{trigger}
			</summary>
			<div className={`dropdown-panel dropdown-${align}`}>
				{children(close)}
			</div>
		</details>
	);
}
