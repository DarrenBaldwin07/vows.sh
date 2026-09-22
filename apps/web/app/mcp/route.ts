import { createAgentMcpHandler } from '@repo/api/mcp';
import { resolveAgent, agentError, checkAgentOrigin } from '@/lib/agent-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
	try {
		checkAgentOrigin(request);
		const { principal, bindings } = await resolveAgent(request);
		const response = await createAgentMcpHandler(principal, bindings).fetch(
			request
		);
		response.headers.set('Cache-Control', 'no-store');
		return response;
	} catch (error) {
		return agentError(error, request);
	}
}
export { handle as POST, handle as GET, handle as DELETE };
