<!--
  MaintenanceDialogs.svelte — the dialogs behind Settings → Maintenance (split
  out of SettingsDropdown in v3.21.0). Mounted outside the dropdown so they
  survive it closing; a button sets `maintenanceTool` (MaintenanceSettings) and
  this opens the matching dialog.
-->
<script>
  import ActivityLogDialog from '../dialog/ActivityLogDialog.svelte';
  import ConvertTaskBoxesDialog from '../dialog/ConvertTaskBoxesDialog.svelte';
  import RelinkOldDialog from '../dialog/RelinkOldDialog.svelte';
  import DuplicateStrokesDialog from '../dialog/DuplicateStrokesDialog.svelte';
  import { maintenanceTool } from './maintenance-tool.js';

  let convertOpen = false;
  let relinkOpen = false;
  let duplicatesOpen = false;

  $: if ($maintenanceTool) {
    if ($maintenanceTool === 'convert') convertOpen = true;
    else if ($maintenanceTool === 'relink') relinkOpen = true;
    else if ($maintenanceTool === 'duplicates') duplicatesOpen = true;
    maintenanceTool.set(null);
  }
</script>

<ActivityLogDialog />
<ConvertTaskBoxesDialog bind:open={convertOpen} />
<RelinkOldDialog bind:open={relinkOpen} />
<DuplicateStrokesDialog bind:open={duplicatesOpen} />
