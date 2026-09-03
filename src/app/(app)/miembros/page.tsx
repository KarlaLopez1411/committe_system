import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';

import {
  MiembrosTabs,
  type MemberRow,
  type ContributionPeriod,
} from './miembros-tabs';
import type { MemberOption } from '../aportaciones/contribution-form';

/**
 * Pantalla combinada de Miembros y Aportaciones con pestañas (Requirements 7.x, 17.x).
 *
 * Server Component: lista los miembros y las aportaciones del comité activo
 * (RLS limita al comité del usuario). El alta de miembros y el registro de
 * aportaciones se hacen desde un botón flotante que abre el formulario en un
 * modal (ver `MiembrosTabs`).
 */
export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();

  const [membersRes, contribRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, full_name, phone, position, status, joined_at, notes, monthly_commitment, monthly_amount')
      .order('created_at', { ascending: true }),
    supabase
      .from('contributions')
      .select('id, member_id, period, contributed_at, status, amount')
      .order('contributed_at', { ascending: false })
      .limit(500),
  ]);

  const members = (membersRes.data ?? []) as MemberRow[];
  const memberName = new Map(members.map((m) => [m.id, m.full_name]));

  // Vínculos usuario↔miembro del comité activo. Se usa tanto para mostrar el
  // badge "Con usuario" en la lista como para prellenar el picker del modal de
  // editar miembro. RLS limita al comité del usuario.
  let linkedUserByMember = new Map<string, string>();
  if (members.length > 0) {
    const memberIds = members.map((m) => m.id);
    const { data: links } = await supabase
      .from('committee_users')
      .select('user_id, member_id')
      .in('member_id', memberIds);
    linkedUserByMember = new Map(
      ((links ?? []) as { user_id: string; member_id: string }[]).map((l) => [
        l.member_id,
        l.user_id,
      ]),
    );
  }

  const rawContributions = (contribRes.data ?? []) as {
    id: string; member_id: string; period: string; status: string; amount: string | null;
  }[];

  // ── Seguimiento por periodo (mes/año) ─────────────────────────────────────
  // Agrupa las aportaciones registradas por periodo. Para cada periodo se
  // listan los miembros que ya reportaron y los miembros COMPROMETIDOS
  // (monthly_commitment) que aún faltan por reportar.
  const committedMembers = members.filter(
    (m) => m.monthly_commitment && m.status === 'activo',
  );

  const byPeriod = new Map<
    string,
    { reported: Map<string, { name: string; amount: string | null }> }
  >();
  for (const c of rawContributions) {
    // Solo cuentan las aportaciones efectivamente registradas.
    if (c.status !== 'registrada') continue;
    const entry = byPeriod.get(c.period) ?? { reported: new Map() };
    if (!entry.reported.has(c.member_id)) {
      entry.reported.set(c.member_id, {
        name: memberName.get(c.member_id) ?? 'Miembro',
        amount: c.amount,
      });
    }
    byPeriod.set(c.period, entry);
  }

  const periods: ContributionPeriod[] = [...byPeriod.entries()]
    .map(([period, { reported }]) => {
      const reportedIds = new Set(reported.keys());
      return {
        period,
        reported: [...reported.entries()]
          .map(([id, v]) => ({ memberId: id, name: v.name, amount: v.amount }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        missing: committedMembers
          .filter((m) => !reportedIds.has(m.id))
          .map((m) => ({ memberId: m.id, name: m.full_name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    // Periodo más reciente primero (period = 'YYYY-MM-01').
    .sort((a, b) => b.period.localeCompare(a.period));

  // Opciones para el formulario de aportaciones: solo miembros activos.
  const memberOptions: MemberOption[] = members
    .filter((m) => m.status === 'activo')
    .map((m) => ({
      id: m.id,
      full_name: m.full_name,
      monthly_commitment: Boolean(m.monthly_commitment),
      monthly_amount: m.monthly_amount ?? null,
    }));

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Miembros</h1>
      <MiembrosTabs
        members={members}
        linkedUserByMember={Object.fromEntries(linkedUserByMember)}
        contributionPeriods={periods}
        memberOptions={memberOptions}
        canCreateMember={perms.canCreateMember}
        canCreateContribution={perms.canCreateTransaction}
        canUpdateMember={perms.canUpdateMember}
        canManageUsers={perms.canManageUsers}
      />
    </section>
  );
}
