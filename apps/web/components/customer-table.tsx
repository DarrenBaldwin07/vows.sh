import { Skeleton } from './ui';
import { Plus } from 'lucide-react';

export function CustomersPageLoading() {
	return (
		<>
			<div className='topbar'>
				<h1 className='topbar-title'>Customers</h1>
				<button
					className='button primary icon-button'
					aria-label='Add customer'
					disabled>
					<Plus size={14} aria-hidden='true' />
				</button>
			</div>
			<div className='page-content customers-page'>
				<div className='list-toolbar'>
					<input
						className='search-input'
						aria-label='Search customers'
						placeholder='Search customers…'
						disabled
					/>
				</div>
				<CustomerTableLoading />
			</div>
		</>
	);
}

export function CustomerTableHeader() {
	return (
		<div className='customer-table-head'>
			<span>Customer</span>
			<span>Open requests</span>
			<span>Last updated</span>
		</div>
	);
}

export function CustomerTableLoading() {
	return (
		<output
			className='customer-table loading-skeleton'
			aria-busy='true'
			aria-label='Loading customers'>
			<span className='sr-only'>Loading customers…</span>
			<CustomerTableHeader />
			<div aria-hidden='true'>
				{Array.from({ length: 4 }, (_, index) => (
					<div className='customer-row customer-row-loading' key={index}>
						<div className='customer-identity'>
							<Skeleton className='customer-image' />
							<span className='customer-loading-name'>
								<strong className='skeleton'>Customer name</strong>
								<small className='skeleton'>customer.com</small>
							</span>
						</div>
						<div>
							<Skeleton className='customer-loading-count' />
						</div>
						<span className='muted'>
							<Skeleton className='customer-loading-date' />
						</span>
					</div>
				))}
			</div>
		</output>
	);
}
