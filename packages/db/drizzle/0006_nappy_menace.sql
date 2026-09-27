ALTER TABLE "CustomerAccess" DROP CONSTRAINT "CustomerAccess_customerId_email_unique";--> statement-breakpoint
ALTER TABLE "CustomerAccess" ADD COLUMN "kind" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "CustomerAccess" ADD CONSTRAINT "CustomerAccess_customerId_kind_email_unique" UNIQUE("customerId","kind","email");