export function toggleVisibleSelection(visibleIds: readonly string[], selectedIds: readonly string[], selectableIds: ReadonlySet<string>): string[] {
    const visible = [...new Set(visibleIds.filter(id => selectableIds.has(id)))], selected = new Set(selectedIds);
    if (visible.length && visible.every(id => selected.has(id)))
        for (const id of visible)
            selected.delete(id);
    else
        for (const id of visible)
            selected.add(id);
    return [...selected];
}
