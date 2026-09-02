import { type NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { createReportService } from '@/server/report-service';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const campaignId = searchParams.get('campaignId');
  const period = searchParams.get('period');
  const format = (searchParams.get('format') ?? 'csv') as 'csv' | 'xlsx' | 'pdf';

  if (!campaignId || !period) {
    return NextResponse.json({ error: 'campaignId and period are required' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: cu } = await supabase.from('committee_users').select('committee_id').eq('user_id', user.id).eq('status', 'active').single();
  if (!cu) return NextResponse.json({ error: 'No active committee' }, { status: 403 });

  const ctx = { userId: user.id, committeeId: (cu as { committee_id: string }).committee_id, permissions: ['reports.read'], isSuperAdmin: false };
  const admin = createSupabaseAdminClient();
  const service = createReportService({ client: admin });

  const result = await service.bonusMonthlyCut(ctx, campaignId, period);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 400 });

  const exported = service.exportReport(result.value, format);
  if (!exported.ok) return NextResponse.json({ error: exported.error.message }, { status: 500 });

  const { content, mimeType, filename } = exported.value;
  return new NextResponse(content, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
