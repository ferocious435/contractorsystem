import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import DocumentsPageClient from '@/components/documents/DocumentsPageClient';
import { isLocalProjectId } from '@/utils/local-projects';

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: projectId } = await params;
    const isLocalProject = isLocalProjectId(projectId);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || '';
    if (!userId && !isLocalProject) return redirect('/login');

    if (!isLocalProject) {
        if (!user) return redirect('/login');

        const { data: project } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .maybeSingle();

        if (!project) return redirect('/login');
    }

    // Fetch initial documents for SSR speed
    const { data: documents } = isLocalProject
        ? { data: [] }
        : await supabase
            .from('documents')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

    return (
        <div className="p-6 h-full flex flex-col">
            <header className="mb-8">
                <h1 className="text-2xl font-rubik font-semibold text-gray-100">מרכז מסמכים וחוזים</h1>
                <p className="text-sm text-gray-400 mt-1">ניהול מסמכים, ניתוח AI וסנכרון נתונים למערכת</p>
            </header>

            <DocumentsPageClient projectId={projectId} initialDocuments={documents || []} />
        </div>
    );
}