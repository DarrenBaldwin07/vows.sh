import { z } from 'zod';
import { and, eq, desc, sql, requestEvent, type Database } from '@repo/db';
import { publicRequestEvent } from './request-events.js';

export async function eventHistory(
	db: Database,
	requestId: string,
	publicOnly: boolean,
	cursor?: string
) {
	const before = cursor ? z.uuid().parse(cursor) : null;
	const rows = await db
		.select()
		.from(requestEvent)
		.where(
			and(
				eq(requestEvent.requestId, requestId),
				publicOnly ? eq(requestEvent.public, true) : undefined,
				// Compare timestamps in Postgres to retain its sub-millisecond precision.
				before
					? sql`(${requestEvent.createdAt}, ${requestEvent.id}) < (select "createdAt", "id" from "RequestEvent" where "id" = ${before} and "requestId" = ${requestId} and (${!publicOnly} or "public"))`
					: undefined
			)
		)
		.orderBy(desc(requestEvent.createdAt), desc(requestEvent.id))
		.limit(51);
	const page = rows.slice(0, 50);
	return {
		events: publicOnly ? page.map(publicRequestEvent) : page,
		nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
	};
}
