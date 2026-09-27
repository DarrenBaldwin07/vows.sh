CREATE TABLE "LinearWebhook" (
	"id" text PRIMARY KEY NOT NULL,
	"integrationId" text NOT NULL,
	"issueId" text NOT NULL,
	"issueUpdatedAt" timestamp with time zone NOT NULL,
	"stateName" text NOT NULL,
	"stateType" text NOT NULL,
	"action" text NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "RequestLinearIssue" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"requestId" text NOT NULL,
	"integrationId" text NOT NULL,
	"issueId" text NOT NULL,
	"identifier" text NOT NULL,
	"url" text NOT NULL,
	"stateName" text NOT NULL,
	"stateType" text NOT NULL,
	"issueUpdatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "RequestLinearIssue_requestId_unique" UNIQUE("requestId")
);
--> statement-breakpoint
ALTER TABLE "RequestEvent" ADD COLUMN "kind" text DEFAULT 'status_changed' NOT NULL;--> statement-breakpoint
ALTER TABLE "RequestEvent" ADD COLUMN "source" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "RequestEvent" ADD COLUMN "public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "RequestEvent" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "LinearWebhook" ADD CONSTRAINT "LinearWebhook_integrationId_Integration_id_fk" FOREIGN KEY ("integrationId") REFERENCES "public"."Integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RequestLinearIssue" ADD CONSTRAINT "RequestLinearIssue_organizationId_requestId_Request_organizationId_id_fk" FOREIGN KEY ("organizationId","requestId") REFERENCES "public"."Request"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RequestLinearIssue" ADD CONSTRAINT "RequestLinearIssue_organizationId_integrationId_Integration_organizationId_id_fk" FOREIGN KEY ("organizationId","integrationId") REFERENCES "public"."Integration"("organizationId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "LinearWebhook_processedAt_receivedAt_index" ON "LinearWebhook" USING btree ("processedAt","receivedAt");--> statement-breakpoint
CREATE INDEX "RequestLinearIssue_integrationId_issueId_index" ON "RequestLinearIssue" USING btree ("integrationId","issueId");--> statement-breakpoint
-- Preserve existing status history and distinguish historical resend requests.
UPDATE "RequestEvent" SET "kind" = CASE WHEN "fromStatus" IS NULL THEN 'created' WHEN "fromStatus" = "toStatus" THEN 'notification_requested' ELSE 'status_changed' END,
"public" = ("fromStatus" IS DISTINCT FROM "toStatus");
--> statement-breakpoint
-- Audit delivery transitions in the same transaction as every worker/cancellation path.
CREATE FUNCTION vows_audit_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status "RequestStatus";
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" AND NEW."attempts" IS NOT DISTINCT FROM OLD."attempts" THEN
        RETURN NEW;
    END IF;
    SELECT "status" INTO current_status FROM "Request" WHERE "id" = NEW."requestId";
    IF current_status IS NULL THEN RETURN NEW; END IF;
    INSERT INTO "RequestEvent" ("id", "requestId", "actorId", "kind", "source", "public", "fromStatus", "toStatus", "changes")
    VALUES (gen_random_uuid()::text, NEW."requestId", 'notification-worker', 'notification_' || NEW."status"::text, 'system', NEW."status" = 'sent', current_status, current_status,
      jsonb_build_object('deliveryStatus', jsonb_build_object('before', CASE WHEN TG_OP = 'UPDATE' THEN OLD."status"::text ELSE NULL END, 'after', NEW."status"::text)));
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "NotificationDelivery_audit" AFTER INSERT OR UPDATE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION vows_audit_delivery();
