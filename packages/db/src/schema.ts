import { sql } from 'drizzle-orm';
import {
	boolean,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = (name = 'createdAt') =>
	timestamp(name, { withTimezone: true }).defaultNow().notNull();
const date = (name: string) => timestamp(name, { withTimezone: true });
export const requestStatus = pgEnum('RequestStatus', [
	'todo',
	'in_progress',
	'in_review',
	'done',
	'canceled',
]);
export const deliveryStatus = pgEnum('DeliveryStatus', [
	'pending',
	'sending',
	'sent',
	'failed',
	'canceled',
	'uncertain',
]);

export const organization = pgTable('Organization', {
	id: id(),
	clerkOrganizationId: text('clerkOrganizationId').notNull().unique(),
	createdAt: createdAt(),
});
export const customer = pgTable(
	'Customer',
	{
		id: id(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		domain: text('domain'),
		archivedAt: date('archivedAt'),
		createdAt: createdAt(),
		updatedAt: createdAt('updatedAt'),
	},
	(t) => [
		unique().on(t.organizationId, t.id),
		index().on(t.organizationId, t.updatedAt),
	]
);
export const customerAccess = pgTable(
	'CustomerAccess',
	{
		id: id(),
		customerId: text('customerId')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		clerkUserId: text('clerkUserId'),
		createdAt: createdAt(),
		revokedAt: date('revokedAt'),
	},
	(t) => [unique().on(t.customerId, t.email)]
);
export const customerShareLink = pgTable(
	'CustomerShareLink',
	{
		id: id(),
		customerId: text('customerId')
			.notNull()
			.references(() => customer.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		createdAt: createdAt(),
		revokedAt: date('revokedAt'),
	},
	(t) => [
		uniqueIndex('CustomerShareLink_active')
			.on(t.customerId)
			.where(sql`${t.revokedAt} is null`),
	]
);
export const request = pgTable(
	'Request',
	{
		id: id(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		customerId: text('customerId').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		internalNotes: text('internalNotes').notNull().default(''),
		status: requestStatus('status').notNull().default('todo'),
		assigneeId: text('assigneeId'),
		completionNote: text('completionNote').notNull().default(''),
		notifyOnDone: boolean('notifyOnDone'),
		createdBy: text('createdBy').notNull(),
		createdAt: createdAt(),
		updatedAt: createdAt('updatedAt'),
		completedAt: date('completedAt'),
	},
	(t) => [
		unique().on(t.organizationId, t.id),
		foreignKey({
			columns: [t.organizationId, t.customerId],
			foreignColumns: [customer.organizationId, customer.id],
		}).onDelete('cascade'),
		index().on(t.customerId, t.status),
	]
);
export const requestEvent = pgTable(
	'RequestEvent',
	{
		id: id(),
		requestId: text('requestId')
			.notNull()
			.references(() => request.id, { onDelete: 'cascade' }),
		actorId: text('actorId').notNull(),
		fromStatus: requestStatus('fromStatus'),
		toStatus: requestStatus('toStatus').notNull(),
		createdAt: createdAt(),
	},
	(t) => [index().on(t.requestId, t.createdAt)]
);
export const integration = pgTable(
	'Integration',
	{
		id: id(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull().default('slack'),
		externalAccountId: text('externalAccountId').notNull(),
		externalAccountName: text('externalAccountName').notNull(),
		encryptedCredentials: text('encryptedCredentials'),
		notifyOnDone: boolean('notifyOnDone').notNull().default(false),
		connectedAt: createdAt('connectedAt'),
		disconnectedAt: date('disconnectedAt'),
	},
	(t) => [
		unique().on(t.organizationId, t.provider),
		unique().on(t.organizationId, t.id),
	]
);
export const requestSlackThread = pgTable(
	'RequestSlackThread',
	{
		id: id(),
		organizationId: text('organizationId').notNull(),
		requestId: text('requestId').notNull().unique(),
		integrationId: text('integrationId').notNull(),
		channelId: text('channelId').notNull(),
		messageTs: text('messageTs').notNull(),
		threadTs: text('threadTs').notNull(),
		permalink: text('permalink').notNull(),
	},
	(t) => [
		foreignKey({
			columns: [t.organizationId, t.requestId],
			foreignColumns: [request.organizationId, request.id],
		}).onDelete('cascade'),
		foreignKey({
			columns: [t.organizationId, t.integrationId],
			foreignColumns: [integration.organizationId, integration.id],
		}).onDelete('cascade'),
	]
);
export const notificationDelivery = pgTable(
	'NotificationDelivery',
	{
		id: id(),
		requestId: text('requestId')
			.notNull()
			.references(() => request.id, { onDelete: 'cascade' }),
		eventId: text('eventId')
			.notNull()
			.references(() => requestEvent.id, { onDelete: 'cascade' }),
		threadId: text('threadId')
			.notNull()
			.references(() => requestSlackThread.id, { onDelete: 'cascade' }),
		status: deliveryStatus('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		nextAttemptAt: createdAt('nextAttemptAt'),
		lockedAt: date('lockedAt'),
		sentAt: date('sentAt'),
		slackMessageTs: text('slackMessageTs'),
		lastError: text('lastError'),
		createdAt: createdAt(),
	},
	(t) => [
		unique().on(t.eventId, t.threadId),
		index().on(t.status, t.nextAttemptAt),
	]
);
