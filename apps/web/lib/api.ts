import type { AppType } from '@repo/api';
import { hc } from 'hono/client';
import { queryOptions } from '@tanstack/react-query';

export const api = hc<AppType>(
	process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002'
);

export const helloQueryOptions = queryOptions({
	queryKey: ['hello'],
	queryFn: async ({ signal }) => {
		const response = await api.hello.$get({}, { init: { signal } });
		if (!response.ok) {
			throw new Error(`Hello request failed (${response.status})`);
		}
		return response.json();
	},
});
