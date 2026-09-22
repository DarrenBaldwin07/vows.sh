import { Skeleton } from './ui';

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
