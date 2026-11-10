-- Busca textual: FTS5 com índice de conteúdo externo sobre document_pages.
-- Tokenizer unicode61 com remoção de diacríticos ("contrato" encontra "Contratô").
CREATE VIRTUAL TABLE `document_pages_fts` USING fts5(
	`text`,
	content='document_pages',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `document_pages_ai` AFTER INSERT ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts`(rowid, `text`) VALUES (new.id, new.text);
END;--> statement-breakpoint
CREATE TRIGGER `document_pages_ad` AFTER DELETE ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts`(`document_pages_fts`, rowid, `text`) VALUES ('delete', old.id, old.text);
END;--> statement-breakpoint
CREATE TRIGGER `document_pages_au` AFTER UPDATE OF `text` ON `document_pages` BEGIN
	INSERT INTO `document_pages_fts`(`document_pages_fts`, rowid, `text`) VALUES ('delete', old.id, old.text);
	INSERT INTO `document_pages_fts`(rowid, `text`) VALUES (new.id, new.text);
END;
