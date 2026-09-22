CREATE TABLE "AgentKey" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"tokenHash" text NOT NULL,
	"permission" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"lastUsedAt" timestamp with time zone,
	CONSTRAINT "AgentKey_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "AgentOperation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"principalId" text NOT NULL,
	"userId" text NOT NULL,
	"operation" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"inputHash" text NOT NULL,
	"result" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "AgentOperation_principalId_idempotencyKey_unique" UNIQUE("principalId","idempotencyKey")
);
--> statement-breakpoint
ALTER TABLE "AgentKey" ADD CONSTRAINT "AgentKey_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AgentKey_organizationId_index" ON "AgentKey" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AgentOperation_organizationId_createdAt_index" ON "AgentOperation" USING btree ("organizationId","createdAt");