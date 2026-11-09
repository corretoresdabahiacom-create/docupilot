CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`decided_by` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`workspace_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `comparison_results` (
	`id` text PRIMARY KEY NOT NULL,
	`comparison_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comparison_id`) REFERENCES `document_comparisons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer,
	`body` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`left_version_id` text NOT NULL,
	`right_version_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`left_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`right_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_hashes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`sha256` text NOT NULL,
	`simhash` text,
	`verified_by_storage` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_hashes_ws_sha_idx` ON `document_hashes` (`workspace_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `document_metadata` (
	`document_id` text PRIMARY KEY NOT NULL,
	`language` text,
	`page_count` integer,
	`extracted_by` text,
	`text_char_count` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`shared_with_user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_versions_doc_num_uq` ON `document_versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `doc_versions_ws_idx` ON `document_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`status` text DEFAULT 'needs_text' NOT NULL,
	`current_version_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_status_ck" CHECK("documents"."status" IN ('needs_text','extracted','needs_ocr','extraction_failed'))
);
--> statement-breakpoint
CREATE INDEX `documents_ws_folder_idx` ON `documents` (`workspace_id`,`folder_id`);--> statement-breakpoint
CREATE TABLE `extracted_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`field_type` text NOT NULL,
	`raw_value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`pattern_id` text NOT NULL,
	`confidence` real NOT NULL,
	`source_kind` text NOT NULL,
	`personal_profile_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "extracted_source_ck" CHECK("extracted_fields"."source_kind" IN ('deterministic','heuristic','ocr','ocr_external','ai_external'))
);
--> statement-breakpoint
CREATE INDEX `extracted_doc_idx` ON `extracted_fields` (`document_id`);--> statement-breakpoint
CREATE INDEX `extracted_profile_idx` ON `extracted_fields` (`personal_profile_id`);--> statement-breakpoint
CREATE TABLE `extraction_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`extracted_field_id` text NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`bbox` text,
	`text_span_start` integer NOT NULL,
	`text_span_end` integer NOT NULL,
	`pattern_id` text NOT NULL,
	`confidence` real NOT NULL,
	FOREIGN KEY (`extracted_field_id`) REFERENCES `extracted_fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extraction_sources_field_idx` ON `extraction_sources` (`extracted_field_id`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`depth` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "folders_depth_ck" CHECK("folders"."depth" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX `folders_ws_parent_idx` ON `folders` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`form_template_id` text NOT NULL,
	`field_name` text NOT NULL,
	`field_kind` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`mapped_to` text,
	FOREIGN KEY (`form_template_id`) REFERENCES `form_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_template_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`payload` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`form_template_id`) REFERENCES `form_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `form_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generated_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`template_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `organization_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`workspace_id` text,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "org_invites_role_ck" CHECK("organization_invites"."role" IN ('owner','admin','manager','approver','editor','viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invites_token_uq` ON `organization_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `organization_members` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "org_members_role_ck" CHECK("organization_members"."role" IN ('owner','admin','manager','approver','editor','viewer'))
);
--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'personal' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orgs_kind_ck" CHECK("organizations"."kind" IN ('personal','company'))
);
--> statement-breakpoint
CREATE INDEX `orgs_owner_idx` ON `organizations` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `personal_data_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pdp_user_idx` ON `personal_data_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_limit_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE INDEX `rate_limit_window_idx` ON `rate_limit_counters` (`window_start`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_ref` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `shared_link_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`shared_link_id` text NOT NULL,
	`accessed_at` integer NOT NULL,
	`ip_hash` text,
	FOREIGN KEY (`shared_link_id`) REFERENCES `shared_links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shared_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_links_token_uq` ON `shared_links` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`cursor` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`declared_mime` text NOT NULL,
	`declared_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reject_reason` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "uploads_status_ck" CHECK("uploads"."status" IN ('pending','completed','rejected','expired'))
);
--> statement-breakpoint
CREATE INDEX `uploads_ws_idx` ON `uploads` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `uploads_expires_idx` ON `uploads` (`expires_at`);--> statement-breakpoint
CREATE TABLE `usage_quotas` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`overrides` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_ws_metric_period_uq` ON `usage_records` (`workspace_id`,`metric`,`period`);--> statement-breakpoint
CREATE TABLE `user_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`provider` text,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `consents_user_purpose_idx` ON `user_consents` (`user_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`locale` text DEFAULT 'pt' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_platform_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_status_ck" CHECK("users"."status" IN ('active','suspended','deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workflow_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflow_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`step_log` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`config` text,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workflow_steps_kind_ck" CHECK("workflow_steps"."kind" IN ('input_extract','validate','compare','generate','approval','output')),
	CONSTRAINT "workflow_steps_pos_ck" CHECK("workflow_steps"."position" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ws_members_role_ck" CHECK("workspace_members"."role" IN ('owner','admin','manager','approver','editor','viewer'))
);
--> statement-breakpoint
CREATE INDEX `ws_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`is_personal` integer DEFAULT false NOT NULL,
	`storage_bytes_used` integer DEFAULT 0 NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspaces_org_idx` ON `workspaces` (`organization_id`);