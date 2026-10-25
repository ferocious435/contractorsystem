'use client';

import { useSyncExternalStore } from 'react';

export const WORKSPACE_VIEW_ROLES = [
    { value: 'developer', label: 'מפתח' },
    { value: 'administrator', label: 'מנהל מערכת' },
    { value: 'contractor', label: 'קבלן' },
] as const;

export type WorkspaceViewRole = typeof WORKSPACE_VIEW_ROLES[number]['value'];

const STORAGE_KEY = 'contractorsystem.workspaceViewRole';
const CHANGE_EVENT = 'contractorsystem:workspace-view-role';
let memoryRole: WorkspaceViewRole = 'developer';
let storageAvailable = true;

function parseRole(value: string | null): WorkspaceViewRole {
    return WORKSPACE_VIEW_ROLES.find((role) => role.value === value)?.value || 'developer';
}

function getSnapshot(): WorkspaceViewRole {
    if (!storageAvailable) return memoryRole;
    try {
        return parseRole(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        storageAvailable = false;
        return memoryRole;
    }
}

function getServerSnapshot(): WorkspaceViewRole {
    return 'developer';
}

function subscribe(callback: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === null) callback();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, callback);
    return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(CHANGE_EVENT, callback);
    };
}

function setViewRole(role: WorkspaceViewRole): void {
    memoryRole = role;
    try {
        window.localStorage.setItem(STORAGE_KEY, role);
    } catch {
        storageAvailable = false;
        // The choice remains available for this page when browser storage is blocked.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useWorkspaceViewRole(): readonly [WorkspaceViewRole, typeof setViewRole] {
    return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setViewRole] as const;
}
