-- Migración 0002 — Identidad y autorización
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 1.1, 1.3, 2.1, 5.1, 6.1, 8.2
--
-- Crea el esquema base de identidad multi-tenant y RBAC:
--   committees, profiles, committee_users, roles, permissions,
--   role_permissions, user_roles
--
-- DDL alineado con design.md, sección "Data Models > Identidad y autorización".
-- Depende de 0001_extensions.sql (pgcrypto -> gen_random_uuid()).
-- Todas las tablas de comité incluyen committee_id NOT NULL (Requirements 2.1).

-- =====================================================================
-- committees (R1.1, R1.3)
-- =====================================================================
CREATE TABLE committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 150),  -- R1.2
  slug TEXT UNIQUE,
  logo_path TEXT,
  locality TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  finance_settings JSONB NOT NULL DEFAULT '{}',
  bonus_settings JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- profiles — perfil aplicativo vinculado 1:1 con auth.users
-- =====================================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- committee_users — membresía usuario<->comité (R2.4, R8.2)
-- =====================================================================
CREATE TABLE committee_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  member_id UUID,                                    -- vínculo opcional a un miembro (R8.2)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (committee_id, user_id),                    -- membresía única por comité
  UNIQUE (committee_id, member_id)                   -- máx. 1 miembro por usuario/comité (R8.2)
);

-- =====================================================================
-- roles — catálogo cerrado de 9 roles predefinidos (R5.1)
-- =====================================================================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL CHECK (key IN
    ('superadmin','committee_admin','president','treasurer','secretary',
     'clerk','bonus_seller','auditor','member')),   -- exactamente 9 roles (R5.1)
  name TEXT NOT NULL,
  UNIQUE (key)
);

-- =====================================================================
-- permissions — catálogo cerrado de 18 permisos (R6.1)
-- =====================================================================
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (key IN
    ('members.read','members.create','members.update',
     'transactions.read','transactions.create','transactions.approve','transactions.void',
     'cash_closings.create','cash_closings.review','cash_closings.close',
     'bonuses.read','bonuses.collect','bonuses.settle','bonuses.draw',
     'reports.read','users.manage','committee.manage','audit.read'))  -- R6.1
);

-- =====================================================================
-- role_permissions — asignación permisos<->rol (R6.3)
-- =====================================================================
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- =====================================================================
-- user_roles — roles de un usuario dentro de un comité (R5.2, R6.3)
-- =====================================================================
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  UNIQUE (committee_id, user_id, role_id)            -- sin duplicar rol por usuario/comité (R5.2)
);

-- Índices de apoyo para resolución de permisos y aislamiento por comité.
CREATE INDEX idx_committee_users_user ON committee_users (user_id);
CREATE INDEX idx_committee_users_committee ON committee_users (committee_id);
CREATE INDEX idx_user_roles_user_committee ON user_roles (user_id, committee_id);
CREATE INDEX idx_role_permissions_role ON role_permissions (role_id);

-- =====================================================================
-- SIEMBRA — 9 roles del catálogo (R5.1)
-- Los nombres son etiquetas legibles alineadas con RF-011 del documento fuente.
-- =====================================================================
INSERT INTO roles (key, name) VALUES
  ('superadmin',      'Superadministrador'),
  ('committee_admin', 'Administrador del comité'),
  ('president',       'Presidente'),
  ('treasurer',       'Tesorero'),
  ('secretary',       'Secretario'),
  ('clerk',           'Capturista'),
  ('bonus_seller',    'Vendedor de bonos'),
  ('auditor',         'Auditor'),
  ('member',          'Miembro')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- SIEMBRA — 18 permisos del catálogo (R6.1)
-- =====================================================================
INSERT INTO permissions (key) VALUES
  ('members.read'),
  ('members.create'),
  ('members.update'),
  ('transactions.read'),
  ('transactions.create'),
  ('transactions.approve'),
  ('transactions.void'),
  ('cash_closings.create'),
  ('cash_closings.review'),
  ('cash_closings.close'),
  ('bonuses.read'),
  ('bonuses.collect'),
  ('bonuses.settle'),
  ('bonuses.draw'),
  ('reports.read'),
  ('users.manage'),
  ('committee.manage'),
  ('audit.read')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- SIEMBRA — role_permissions (mapeo RBAC)
-- Los roles son agrupaciones de permisos (RF-012). El mapeo aplica
-- mínimo privilegio según el alcance de cada rol (RF-011):
--   superadmin      -> todos los permisos (administración global)
--   committee_admin -> configuración del comité + gestión de usuarios + lectura amplia
--   president       -> supervisión y aprobaciones
--   treasurer       -> operaciones financieras y de bonos completas
--   secretary       -> miembros y actividades
--   clerk           -> captura limitada (crear, sin aprobar/anular/cerrar)
--   bonus_seller    -> bonos asignados y cobros
--   auditor         -> SOLO lectura + audit.read, ningún permiso de escritura (R5.5, R5.6, R36.5)
--   member          -> lectura mínima propia (reportes)
--
-- Idempotente: se apoya en el PK (role_id, permission_id) con ON CONFLICT.
-- =====================================================================

-- superadmin: catálogo completo de permisos
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'superadmin'
ON CONFLICT DO NOTHING;

-- committee_admin: todos los permisos del comité (igual que superadmin a nivel de comité)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'committee_admin'
ON CONFLICT DO NOTHING;

-- president: supervisión y aprobaciones (aprobar transacciones, revisar/cerrar cortes, lectura)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read','transactions.read','transactions.approve',
  'cash_closings.review','cash_closings.close',
  'bonuses.read','bonuses.draw','reports.read','audit.read'
)
WHERE r.key = 'president'
ON CONFLICT DO NOTHING;

-- treasurer: operaciones financieras y de bonos completas
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read',
  'transactions.read','transactions.create','transactions.approve','transactions.void',
  'cash_closings.create','cash_closings.review','cash_closings.close',
  'bonuses.read','bonuses.collect','bonuses.settle','bonuses.draw',
  'reports.read'
)
WHERE r.key = 'treasurer'
ON CONFLICT DO NOTHING;

-- secretary: miembros y actividades, lectura financiera básica
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read','members.create','members.update',
  'transactions.read','bonuses.read','reports.read'
)
WHERE r.key = 'secretary'
ON CONFLICT DO NOTHING;

-- clerk (capturista): captura limitada, sin aprobar/anular/cerrar
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read','members.create',
  'transactions.read','transactions.create',
  'bonuses.read','reports.read'
)
WHERE r.key = 'clerk'
ON CONFLICT DO NOTHING;

-- bonus_seller: bonos asignados y cobros
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'bonuses.read','bonuses.collect'
)
WHERE r.key = 'bonus_seller'
ON CONFLICT DO NOTHING;

-- auditor: SOLO lectura + audit.read; ningún permiso de escritura (R5.5, R5.6, R36.5)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read','transactions.read','bonuses.read','reports.read','audit.read'
)
WHERE r.key = 'auditor'
ON CONFLICT DO NOTHING;

-- member: información limitada propia (lectura de reportes)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'reports.read'
)
WHERE r.key = 'member'
ON CONFLICT DO NOTHING;
