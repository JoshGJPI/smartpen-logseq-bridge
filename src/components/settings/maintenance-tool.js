import { writable } from 'svelte/store';

/** Which Settings → Maintenance dialog to open: 'convert' | 'relink' | 'duplicates' | null (MaintenanceDialogs opens it). */
export const maintenanceTool = writable(null);
