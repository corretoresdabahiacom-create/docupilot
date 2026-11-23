-- Busca textual (Postgres): tsvector 'simple' sobre o texto SEM acento e em minúsculas.
-- `f_unaccent` é IMMUTABLE (translate puro, sem extensão), então pode ser usada em coluna gerada.
CREATE FUNCTION f_unaccent(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT translate(input, 'àáâãäåçèéêëìíîïñòóôõöøùúûüýÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĵķĺļľłńņňōŏőŕŗřśŝşšţťŧũūŭůűųŵŷźżž', 'aaaaaaceeeeiiiinoooooouuuuyyaaaccccddeeeeegggghhiiiiijkllllnnnooorrrsssstttuuuuuuwyzzz') $$;--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', f_unaccent(lower("text")))) STORED;--> statement-breakpoint
CREATE INDEX "document_pages_text_search_idx" ON "document_pages" USING gin ("text_search");--> statement-breakpoint
-- Sinalizadores de recursos: tudo desligado (R7/R8).
INSERT INTO "feature_flags" ("key", "enabled", "updated_at") VALUES
  ('monetization_enabled', false, (extract(epoch from now()) * 1000)::bigint),
  ('ai_external_enabled', false, (extract(epoch from now()) * 1000)::bigint);--> statement-breakpoint
-- Supabase expõe o schema public por PostgREST (chaves anon/authenticated). O app acessa o banco
-- só pelo Worker, com a connection string. RLS ligado sem nenhuma policy = a API pública não lê
-- nem escreve nada. Em Postgres sem esses papéis (testes locais) só o RLS é aplicado.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
