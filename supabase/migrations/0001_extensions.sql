-- Migración 0001 — Extensiones de PostgreSQL
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 40.3 (seguridad/servidor), 44.1 (infraestructura de datos)
--
-- Habilita las extensiones necesarias antes de crear el esquema.
-- pgcrypto provee `gen_random_uuid()`, usado como DEFAULT de todas las
-- llaves primarias UUID del modelo de datos (ver design.md, sección Data Models).
--
-- Las extensiones se instalan en el esquema `extensions` para mantener
-- el esquema `public` limpio y evitar conflictos de búsqueda.

CREATE SCHEMA IF NOT EXISTS extensions;

-- pgcrypto: funciones criptográficas y generación de UUID v4 aleatorios
-- (gen_random_uuid()). Es la base de la identidad de todas las entidades.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Nota: en un proyecto Supabase gestionado, `gen_random_uuid()` también está
-- disponible de forma nativa en PostgreSQL 13+, pero declaramos pgcrypto de
-- forma explícita para que las migraciones sean autocontenidas y reproducibles
-- en cualquier instancia local o de PostgreSQL estándar.
