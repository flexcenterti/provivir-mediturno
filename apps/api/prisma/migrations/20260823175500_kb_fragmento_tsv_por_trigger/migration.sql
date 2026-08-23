-- La migración anterior definió `kb_fragmento.tsv` como columna GENERATED.
-- Funciona, pero choca con el diff de Prisma: al comparar el esquema contra
-- `tsv Unsupported("tsvector")?` la ve como deriva y en cada `migrate dev` intenta
-- revertirla, arrastrándose además los índices GIN.
--
-- Un trigger da exactamente la misma garantía —el índice no puede quedar
-- desincronizado del texto— y es invisible para el diff, porque Prisma no modela
-- triggers ni funciones.

ALTER TABLE "kb_fragmento" ALTER COLUMN "tsv" DROP EXPRESSION;

CREATE OR REPLACE FUNCTION kb_fragmento_tsv_actualizar() RETURNS trigger AS $$
BEGIN
  NEW."tsv" := to_tsvector('spanish', inmutable_unaccent(coalesce(NEW."texto", '')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kb_fragmento_tsv ON "kb_fragmento";
CREATE TRIGGER kb_fragmento_tsv
  BEFORE INSERT OR UPDATE OF "texto" ON "kb_fragmento"
  FOR EACH ROW EXECUTE FUNCTION kb_fragmento_tsv_actualizar();

-- Reindexa lo que ya existiera. Hoy la tabla está vacía, pero deja la migración
-- correcta si se aplica sobre una base con contenido.
UPDATE "kb_fragmento"
   SET "tsv" = to_tsvector('spanish', inmutable_unaccent(coalesce("texto", '')));
