ALTER TABLE `extracted_fields` ADD `label` text;--> statement-breakpoint
ALTER TABLE `extraction_sources` ADD `snippet` text;--> statement-breakpoint
CREATE INDEX `extraction_sources_doc_idx` ON `extraction_sources` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_tasks_doc_kind_idx` ON `document_tasks` (`document_id`,`kind`);