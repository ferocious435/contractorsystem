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
        <div className="titanium-theme ti-documents-route">
            <DocumentsPageClient projectId={projectId} initialDocuments={documents || []} />
        </div>
    );
}
