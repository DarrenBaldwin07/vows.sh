CREATE TABLE "PortalPath" (
	"path" text PRIMARY KEY NOT NULL,
	"shareLinkId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PortalWorkspace" (
	"slug" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CustomerShareLink" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "Organization" ADD COLUMN "portalSlug" text;--> statement-breakpoint
ALTER TABLE "PortalPath" ADD CONSTRAINT "PortalPath_shareLinkId_CustomerShareLink_id_fk" FOREIGN KEY ("shareLinkId") REFERENCES "public"."CustomerShareLink"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PortalWorkspace" ADD CONSTRAINT "PortalWorkspace_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE no action;