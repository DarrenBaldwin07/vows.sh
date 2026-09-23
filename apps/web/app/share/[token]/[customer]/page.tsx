import { auth } from '@clerk/nextjs/server';
import { CustomerPortal } from '@/components/customer-portal';

// The first segment shares its parameter name with the legacy /share/:token route.
export default async function ReadableSharePage({
	params,
}: {
	params: Promise<{ token: string; customer: string }>;
}) {
	await auth.protect();
	const { token: workspace, customer } = await params;
	return <CustomerPortal address={{ workspace, customer }} />;
}
