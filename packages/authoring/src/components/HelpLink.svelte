<script lang="ts">
  interface Props {
    doc: string;
    children?: import('svelte').Snippet;
  }
  let { doc, children }: Props = $props();
  const href = `./docs.html#${doc}`;
</script>

<a {href} target="_blank" rel="noopener noreferrer" class="help-link">
  {@render children?.()}
</a>

<style>
  .help-link { 
    color: #13a4df;
    text-shadow: none;
   }
  .help-link:hover { color: #bfdbfe; }
</style>
