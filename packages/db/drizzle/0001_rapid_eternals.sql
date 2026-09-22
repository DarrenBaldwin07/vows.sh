CREATE TYPE "public"."DeliveryStatus" AS ENUM('pending', 'sending', 'sent', 'failed', 'canceled', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."RequestStatus" AS ENUM('todo', 'in_progress', 'in_review', 'done', 'canceled');--> statement-breakpoint
CREATE TABLE "Customer" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Customer_organizationId_id_unique" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "CustomerAccess" (
	"id" text PRIMARY KEY NOT NULL,
	"customerId" text NOT NULL,
	"email" text NOT NULL,
	"clerkUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "CustomerAccess_customerId_email_unique" UNIQUE("customerId","email")
);
--> statement-breakpoint
CREATE TABLE "CustomerShareLink" (
	"id" text PRIMARY KEY NOT NULL,
	"customerId" text NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "CustomerShareLink_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "Integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text DEFAULT 'slack' NOT NULL,
	"externalAccountId" text NOT NULL,
	"externalAccountName" text NOT NULL,
	"encryptedCredentials" text,
	"notifyOnDone" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnectedAt" timestamp with time zone,
	CONSTRAINT "Integration_organizationId_provider_unique" UNIQUE("organizationId","provider"),
	CONSTRAINT "Integration_organizationId_id_unique" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "NotificationDelivery" (
	"id" text PRIMARY KEY NOT NULL,
	"requestId" text NOT NULL,
	"eventId" text NOT NULL,
	"threadId" text NOT NULL,
	"status" "DeliveryStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lockedAt" timestamp with time zone,
	"sentAt" timestamp with time zone,
	"slackMessageTs" text,
	"lastError" text,
	CONSTRAINT "NotificationDelivery_eventId_threadId_unique" UNIQUE("eventId","threadId")
);
--> statement-breakpoint
CREATE TABLE "Organization" (
	"id" text PRIMARY KEY NOT NULL,
	"clerkOrganizationId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Organization_clerkOrganizationId_unique" UNIQUE("clerkOrganizationId")
);
--> statement-breakpoint
CREATE TABLE "Request" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"customerId" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"internalNotes" text DEFAULT '' NOT NULL,
	"status" "RequestStatus" DEFAULT 'todo' NOT NULL,
	"assigneeId" text,
	"completionNote" text DEFAULT '' NOT NULL,
	"notifyOnDone" boolean,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	CONSTRAINT "Request_organizationId_id_unique" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "RequestEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"requestId" text NOT NULL,
	"actorId" text NOT NULL,
	"fromStatus" "RequestStatus",
	"toStatus" "RequestStatus" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RequestSlackThread" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"requestId" text NOT NULL,
	"integrationId" text NOT NULL,
	"channelId" text NOT NULL,
	"messageTs" text NOT NULL,
	"threadTs" text NOT NULL,
	"permalink" text NOT NULL,
	CONSTRAINT "RequestSlackThread_requestId_unique" UNIQUE("requestId")
);
--> statement-breakpoint
DROP TABLE "greetings" CASCADE;--> statement-breakpoint
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CustomerAccess" ADD CONSTRAINT "CustomerAccess_customerId_Customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CustomerShareLink" ADD CONSTRAINT "CustomerShareLink_customerId_Customer_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_requestId_Request_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_RequestEvent_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."RequestEvent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_threadId_RequestSlackThread_id_fk" FOREIGN KEY ("threadId") REFERENCES "public"."RequestSlackThread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Request" ADD CONSTRAINT "Request_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Request" ADD CONSTRAINT "Request_organizationId_customerId_Customer_organizationId_id_fk" FOREIGN KEY ("organizationId","customerId") REFERENCES "public"."Customer"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_requestId_Request_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RequestSlackThread" ADD CONSTRAINT "RequestSlackThread_organizationId_requestId_Request_organizationId_id_fk" FOREIGN KEY ("organizationId","requestId") REFERENCES "public"."Request"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RequestSlackThread" ADD CONSTRAINT "RequestSlackThread_organizationId_integrationId_Integration_organizationId_id_fk" FOREIGN KEY ("organizationId","integrationId") REFERENCES "public"."Integration"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Customer_organizationId_createdAt_index" ON "Customer" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomerShareLink_active" ON "CustomerShareLink" USING btree ("customerId") WHERE "CustomerShareLink"."revokedAt" is null;--> statement-breakpoint
CREATE INDEX "NotificationDelivery_status_createdAt_index" ON "NotificationDelivery" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "Request_customerId_status_index" ON "Request" USING btree ("customerId","status");--> statement-breakpoint
CREATE INDEX "RequestEvent_requestId_createdAt_index" ON "RequestEvent" USING btree ("requestId","createdAt");