import LocalAiCheckClient from './LocalAiCheckClient';

export default async function LocalAiCheckPage({
    searchParams,
}: {
    searchParams: Promise<{ findingRef?: string }>;
}) {
    const { findingRef } = await searchParams;
    return <LocalAiCheckClient findingRef={findingRef?.trim() || 'C-CE6070'} />;
}
