-- Migración 0016 — Código de invitación alfanumérico para comités
-- Permite a nuevos usuarios unirse a un comité existente mediante un código
-- de 6 caracteres alfanuméricos en mayúsculas (ej. "ABC123").

ALTER TABLE committees
  ADD COLUMN code TEXT UNIQUE;

-- Índice para búsqueda rápida por código (case-insensitive via upper()).
CREATE INDEX idx_committees_code ON committees (code);

COMMENT ON COLUMN committees.code IS
  'Código de invitación alfanumérico (6 chars, mayúsculas). Generado al crear el comité; lo comparte el administrador para que nuevos usuarios se unan.';
