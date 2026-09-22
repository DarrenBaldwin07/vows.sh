import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { and, eq, integration, requestSlackThread } from '@repo/db';
import { admin, identity, type Env } from '../context.js';
import { decrypt, encrypt, newToken, slackConfigured } from '../slack.js';

export const slackRoutes = new Hono<Env>();
slackRoutes.get('/connect', (c) => {
	admin(c);
	if (!slackConfigured())
		throw new HTTPException(503, {
			message: 'Slack is not configured on this deployment.',
		});
	const state = encrypt(
		JSON.stringify({
			nonce: newToken(),
			userId: identity(c).userId,
			organizationId: c.get('organizationId'),
			expires: Date.now() + 600000,
		})
	);
	setCookie(c, 'vows_slack_state', state, {
		httpOnly: true,
		secure: new URL(process.env.APP_URL!).protocol === 'https:',
		sameSite: 'Lax',
		path: '/api/manage/slack',
		maxAge: 600,
	});
	const url = new URL('https://slack.com/oauth/v2/authorize');
	url.searchParams.set('client_id', process.env.SLACK_CLIENT_ID!);
	url.searchParams.set('scope', 'chat:write');
	url.searchParams.set(
		'redirect_uri',
		`${process.env.APP_URL!.replace(/\/$/, '')}/api/manage/slack/callback`
	);
	url.searchParams.set('state', state);
	return c.redirect(url.toString());
});
slackRoutes.get('/callback', async (c) => {
	admin(c);
	const state = c.req.query('state');
	const cookie = getCookie(c, 'vows_slack_state');
	deleteCookie(c, 'vows_slack_state', { path: '/api/manage/slack' });
	if (!state || !cookie || state !== cookie)
		throw new HTTPException(400, {
			message: 'Slack connection expired. Try again.',
		});
	let payload: { userId: string; organizationId: string; expires: number };
	try {
		payload = JSON.parse(decrypt(state));
	} catch {
		throw new HTTPException(400, { message: 'Invalid connection state.' });
	}
	if (
		payload.userId !== identity(c).userId ||
		payload.organizationId !== c.get('organizationId') ||
		payload.expires < Date.now()
	)
		throw new HTTPException(400, {
			message: 'Your workspace or session changed. Reconnect Slack.',
		});
	if (c.req.query('error')) return c.redirect('/integrations?slack=canceled');
	const code = c.req.query('code');
	if (!code)
		throw new HTTPException(400, {
			message: 'Slack did not return an authorization code.',
		});
	const response = await fetch('https://slack.com/api/oauth.v2.access', {
		method: 'POST',
		body: new URLSearchParams({
			client_id: process.env.SLACK_CLIENT_ID!,
			client_secret: process.env.SLACK_CLIENT_SECRET!,
			code,
			redirect_uri: `${process.env.APP_URL!.replace(/\/$/, '')}/api/manage/slack/callback`,
		}),
		signal: AbortSignal.timeout(15000),
	});
	const result = (await response.json()) as {
		ok: boolean;
		access_token?: string;
		team?: { id: string; name: string };
	};
	if (!result.ok || !result.access_token || !result.team)
		throw new HTTPException(400, {
			message: 'Slack connection failed. Try connecting again.',
		});
	const team = result.team;
	const credentials = encrypt(result.access_token);
	await c.get('db').transaction(async (tx) => {
		const [previous] = await tx
			.select()
			.from(integration)
			.where(
				and(
					eq(integration.organizationId, c.get('organizationId')),
					eq(integration.provider, 'slack')
				)
			)
			.for('update');
		if (previous && previous.externalAccountId !== team.id)
			await tx
				.delete(requestSlackThread)
				.where(eq(requestSlackThread.integrationId, previous.id));
		await tx
			.insert(integration)
			.values({
				organizationId: c.get('organizationId'),
				provider: 'slack',
				externalAccountId: team.id,
				externalAccountName: team.name,
				encryptedCredentials: credentials,
			})
			.onConflictDoUpdate({
				target: [integration.organizationId, integration.provider],
				set: {
					externalAccountId: team.id,
					externalAccountName: team.name,
					encryptedCredentials: credentials,
					connectedAt: new Date(),
					disconnectedAt: null,
				},
			});
	});
	return c.redirect('/integrations?slack=connected');
});
