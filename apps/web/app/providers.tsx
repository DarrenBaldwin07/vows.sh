'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/nextjs';

export function Providers({ children }: { children: ReactNode }) {
	const { userId } = useAuth();
	return <QueryScope key={userId ?? 'signed-out'}>{children}</QueryScope>;
}
function QueryScope({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
	);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
