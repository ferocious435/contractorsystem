import React from 'react';
import {createRoot} from 'react-dom/client';
import DocumentsPageClient from '@/components/documents/DocumentsPageClient';
const projectId='30000000-0000-4000-8000-000000000003';
createRoot(document.getElementById('root')!).render(<main><p>Вымышленный документ. Настоящие файлы и записи не изменяются.</p><DocumentsPageClient projectId={projectId}/></main>);
