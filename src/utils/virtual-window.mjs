export function calculateFixedVirtualWindow({
    itemCount,
    scrollTop = 0,
    viewportHeight = 0,
    rowHeight,
    overscan = 0,
    fallbackVisibleRows = 12,
}) {
    const safeItemCount = Math.max(0, Math.floor(Number(itemCount) || 0));
    const safeRowHeight = Math.max(1, Number(rowHeight) || 1);
    const safeOverscan = Math.max(0, Math.floor(Number(overscan) || 0));
    const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
    const effectiveViewportHeight = Math.max(
        safeRowHeight,
        Number(viewportHeight) || safeRowHeight * fallbackVisibleRows
    );
    const startIndex = Math.max(0, Math.floor(safeScrollTop / safeRowHeight) - safeOverscan);
    const visibleCount = Math.max(
        1,
        Math.ceil(effectiveViewportHeight / safeRowHeight) + safeOverscan * 2
    );
    const endIndex = Math.min(safeItemCount, startIndex + visibleCount);

    return {
        startIndex,
        endIndex,
        topPadding: startIndex * safeRowHeight,
        bottomPadding: Math.max(0, (safeItemCount - endIndex) * safeRowHeight),
    };
}
