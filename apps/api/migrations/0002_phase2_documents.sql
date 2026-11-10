CREATE TABLE `document_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` text NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_pages_version_page_uq` ON `document_pages` (`version_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `doc_pages_workspace_idx` ON `document_pages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `doc_pages_document_idx` ON `document_pages` (`document_id`);--> statement-breakpoint
ALTER TABLE `document_metadata` ADD `page_kind` text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `document_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `text_chars_used` integer DEFAULT 0 NOT NULL;