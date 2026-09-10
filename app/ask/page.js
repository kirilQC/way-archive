import { db } from '../../lib/supabase.js';
import AskClient from './AskClient.js';

export const metadata = { title: 'Way Archive' };
export const dynamic = 'force-dynamic';

export default async function AskPage() {
  const { data } = await db()
    .from('sermons')
    .select('id,title,date,speaker,thumbnail')
    .eq('status', 'published')
    .order('date', { ascending: false })
    .limit(3);

  return <AskClient recent={data || []} />;
}
