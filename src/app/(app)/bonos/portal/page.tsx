import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSellerPortalService } from '@/server/seller-portal-service';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { SellerPortalView } from './seller-portal-view';

export const dynamic = 'force-dynamic';

/** Returns the first day of the current month as YYYY-MM-DD. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default async function SellerPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = params.period ?? currentPeriod();

  // Resolve user + committee from session cookies.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return <p className="p-6 text-sm text-red-600">Sesión no encontrada. Inicia sesión primero.</p>;
  }

  // Build a minimal Ctx from the session — permissions resolved at service level.
  const { data: committeeUser } = await supabase
    .from('committee_users')
    .select('committee_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!committeeUser) {
    return <p className="p-6 text-sm text-red-600">No perteneces a ningún comité activo.</p>;
  }

  const ctx = {
    userId: user.id,
    committeeId: (committeeUser as { committee_id: string }).committee_id,
    permissions: [],
    isSuperAdmin: false,
  };

  // Use admin client so the service can read bonus_sellers with committee_id filter.
  const adminClient = createSupabaseAdminClient();
  const service = createSellerPortalService({ client: adminClient });

  const sellerResult = await service.findSeller(ctx);
  if (!sellerResult.ok) {
    return (
      <section className="p-6">
        <h1 className="text-xl font-bold">Portal de vendedor</h1>
        <p className="mt-4 text-sm text-gray-500">
          No tienes un perfil de vendedor en este comité. Contacta al administrador para que te asigne un perfil.
        </p>
      </section>
    );
  }

  const seller = sellerResult.value;
  const assignmentsResult = await service.getAssignments(ctx, seller.id, period);
  const assignments = assignmentsResult.ok ? assignmentsResult.value : [];

  // Fetch campaign ID for the current period — used for batch reports.
  const { data: campaign } = await adminClient
    .from('bonus_campaigns')
    .select('id, name')
    .eq('committee_id', ctx.committeeId)
    .single();

  return (
    <section className="flex flex-col gap-4 pb-24">
      <header className="sticky top-0 z-10 bg-white px-4 pt-4 pb-2 dark:bg-gray-950">
        <h1 className="text-xl font-bold">Portal de vendedor</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Hola, <span className="font-medium">{seller.displayName}</span> · Periodo: {period}
        </p>
      </header>

      <SellerPortalView
        sellerId={seller.id}
        campaignId={campaign ? (campaign as { id: string }).id : null}
        assignments={assignments}
        period={period}
      />
    </section>
  );
}
