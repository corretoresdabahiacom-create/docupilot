CREATE TABLE "folder_members" (
	"folder_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "folder_members_folder_id_user_id_pk" PRIMARY KEY("folder_id","user_id"),
	CONSTRAINT "folder_members_access_ck" CHECK ("folder_members"."access" IN ('view','edit'))
);
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_members" ADD CONSTRAINT "folder_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_members_user_idx" ON "folder_members" USING btree ("user_id");--> statement-breakpoint
-- Tabelas criadas depois da 0001 também ficam com RLS ligado e sem policies (ver 0001).
ALTER TABLE "folder_members" ENABLE ROW LEVEL SECURITY;
