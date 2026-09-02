-- Migración 0006 — Auditoría, notificaciones e índices de agregación
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 36.1, 45.1
--
-- Crea el esquema de trazabilidad y notificaciones:
--   audit_logs, notifications
-- y agrega los índices que soportan las agregaciones eficientes del
-- dashboard y los reportes (R45.1, RNF-008).
--
-- DDL alineado con design.md, sección "Data Models > Auditoría y notificaciones",
-- y con el modelo preliminar de SAC_requerimientos_diseno_tecnico.md §14.7.
-- Depende de 0001_extensions.sql (pgcrypto -> gen_random_uuid()),
-- 0002_identity_authz.sql (committees),
-- 0003_members_finance.sql (financial_transactions, ledger_entries),
-- 0004_contributions_donations_activities.sql,
-- 0005_bonus.sql (bonus_monthly_dues, bonus_collections, bonus_settlements).
--
-- Convenciones (design.md > Data Models):
--   - committee_id UUID REFERENCES committees(id); en audit_logs es NULL-able
--     porque existen acciones globales de plataforma sin comité (R36.1).
--   - created_at TIMESTAMPTZ NOT NULL DEFAULT now().
--   - JSONB para snapshots de valores anteriores/nuevos.
--
-- INMUTABILIDAD de audit_logs (R36.2): no se definen políticas de UPDATE/DELETE
--   para roles de aplicación; eso se establece en la migración de RLS (2.7).

-- =====================================================================
-- audit_logs — bitácora inmutable de operaciones sensibles (R36.1–36.3)
-- Toda operación sensible exitosa produce un registro atribuible a un
-- usuario (user_id) y a una fecha/hora (created_at), con la entidad y el
-- registro afectados (entity_type, entity_id) y, cuando aplica, el motivo.
-- committee_id es NULL para acciones globales de plataforma.
-- =====================================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID REFERENCES committees(id),               -- NULL para acciones globales
  user_id UUID NOT NULL,                                     -- atribución obligatoria (R36.1, R36.3)
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,                                               -- requerido en eliminación/ajuste (R36.1)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()              -- fecha/hora con precisión de segundos
);

-- =====================================================================
-- notifications — notificaciones por usuario/comité
-- read_at NULL = no leída.
-- =====================================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Índices de auditoría y notificaciones
-- =====================================================================
-- Consulta de auditoría por comité ordenada por fecha (reporte 17, R45.1).
CREATE INDEX idx_audit_logs_committee_created ON audit_logs (committee_id, created_at);
-- Rastreo de una entidad concreta (¿qué cambió en este registro?).
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
-- Actividad por usuario.
CREATE INDEX idx_audit_logs_user ON audit_logs (user_id);
-- Bandeja de notificaciones no leídas por usuario/comité.
CREATE INDEX idx_notifications_committee ON notifications (committee_id);
CREATE INDEX idx_notifications_user ON notifications (user_id);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- =====================================================================
-- Índices de agregación para dashboard y reportes (R45.1, RNF-008)
-- Objetivo: evitar cálculos de históricos completos en el cliente y
-- resolver sumatorias por comité/periodo/cuenta usando índices.
-- =====================================================================

-- Ingresos/egresos por periodo y categoría (dashboard: ingresos/egresos del
-- mes, resultado del mes; reportes 4 y 5). Filtro típico:
--   WHERE committee_id = ? AND transaction_date BETWEEN ? AND ?
CREATE INDEX idx_ft_committee_date
  ON financial_transactions (committee_id, transaction_date);
-- Agregación por categoría dentro de un comité (reportes por categoría).
CREATE INDEX idx_ft_committee_category_date
  ON financial_transactions (committee_id, category_id, transaction_date);
-- Movimientos por actividad (resultado de actividad, R20.x).
CREATE INDEX idx_ft_committee_activity
  ON financial_transactions (committee_id, activity_id);

-- Saldo derivado por cuenta = opening_balance + SUM(ledger_entries.amount)
-- (R10.1). Saldo consolidado y saldo por cuenta del dashboard.
--   WHERE committee_id = ? [AND account_id = ?]
CREATE INDEX idx_ledger_committee_account
  ON ledger_entries (committee_id, account_id);
-- Saldo teórico del corte por cuenta y periodo (cash_closings, R22.x):
-- suma de apuntes de una cuenta acotada por fecha del apunte.
CREATE INDEX idx_ledger_committee_account_created
  ON ledger_entries (committee_id, account_id, created_at);

-- Estado mensual de bonos (reporte 9) y corte mensual de bonos:
-- esperado/cobrado/pendiente por campaña y periodo.
CREATE INDEX idx_bonus_dues_committee_campaign_period
  ON bonus_monthly_dues (committee_id, campaign_id, period);
-- Cobrado por vendedor en un periodo (dashboard: cobrado por vendedores;
-- reporte 11 estado por vendedor).
CREATE INDEX idx_bonus_collections_committee_seller_collected
  ON bonus_collections (committee_id, seller_id, collected_at);
-- Entregado a tesorería por campaña/periodo (dashboard: entregado a tesorería;
-- reporte 12 entregas de vendedores). Se indexa por fecha de reporte.
CREATE INDEX idx_bonus_settlements_committee_campaign_reported
  ON bonus_settlements (committee_id, campaign_id, reported_at);

-- Aportaciones del periodo por comité (dashboard: aportaciones del periodo;
-- reporte 6). Nota: ya existe idx_contributions_period(committee_id, period)
-- en 0003/0004; no se duplica aquí.
