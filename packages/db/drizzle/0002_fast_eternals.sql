ALTER TABLE "Integration" RENAME COLUMN "createdAt" TO "connectedAt";--> statement-breakpoint
DROP INDEX "Customer_organizationId_createdAt_index";--> statement-breakpoint
DROP INDEX "NotificationDelivery_status_createdAt_index";--> statement-breakpoint
ALTER TABLE "Customer" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "NotificationDelivery" ADD COLUMN "nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "Request" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "Customer_organizationId_updatedAt_index" ON "Customer" USING btree ("organizationId","updatedAt");--> statement-breakpoint
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_index" ON "NotificationDelivery" USING btree ("status","nextAttemptAt");