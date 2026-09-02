-- Migración 0018 — Categorías básicas de ingresos y egresos por defecto
-- =====================================================================
-- Siembra un conjunto común de categorías de transacción para TODOS los comités
-- existentes. Las nuevas altas de comité también las reciben desde la Server
-- Action de registro (`signUpAction`). Mantener ambas listas alineadas.
--
-- Idempotente: `ON CONFLICT (committee_id, name) DO NOTHING` evita duplicar
-- categorías que un comité ya tenga (la tabla tiene UNIQUE (committee_id, name)).
-- =====================================================================

INSERT INTO transaction_categories (committee_id, name)
SELECT c.id, cat.name
FROM committees c
CROSS JOIN (
  VALUES
    -- Ingresos comunes
    ('Cuotas'),
    ('Aportaciones'),
    ('Donaciones'),
    ('Actividades'),
    ('Bonos'),
    ('Otros ingresos'),
    -- Egresos comunes
    ('Mantenimiento'),
    ('Servicios'),
    ('Papelería'),
    ('Eventos'),
    ('Premios'),
    ('Otros egresos')
) AS cat(name)
ON CONFLICT (committee_id, name) DO NOTHING;
