<script lang="ts">
  let active = $state(false);
  export function setActive(value: boolean) { active = value; }
</script>
{#if active}
  <div data-import-review-view data-page-import-drop role="status" class="gb:review-ui:[position:fixed] gb:review-ui:[inset:16px] gb:review-ui:[z-index:9999] gb:review-ui:[pointer-events:none] gb:review-ui:[display:grid] gb:review-ui:[place-items:center] gb:review-ui:[border:3px_dashed_var(--accent)] gb:review-ui:[border-radius:var(--radius-sm)] gb:review-ui:[background:color-mix(in_srgb,_var(--bg-card)_92%,_transparent)] gb:review-ui:[color:var(--text-primary)] gb:review-ui:[font-size:20px] gb:review-ui:[text-align:center]">
    <div><strong>Drop files to import</strong><p>Review the detected file types before importing.</p></div>
  </div>
{/if}
