<!--
  HierarchyTree.svelte - Visual tree structure for hierarchical content
-->
<script>
  export let lines = [];
  
  // Build a tree structure from lines based on indentation
  $: tree = buildTree(lines);
  
  function buildTree(lines) {
    if (!lines || lines.length === 0) return [];
    
    const root = [];
    const stack = [{ children: root, indent: -1 }];
    
    lines.forEach((line, index) => {
      const indent = line.indent || line.indentLevel || 0;
      const node = {
        index,
        text: line.text || line.content || '',
        indent,
        children: []
      };
      
      // Find parent based on indentation
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    
    return root;
  }
</script>

{#if tree.length > 0}
  <section class="hierarchy-tree">
    <h3>Structure View</h3>
    <div class="tree">
      {#each tree as node (node.index)}
        <svelte:self lines={[node, ...node.children.flatMap(c => [c, ...c.children])]} />
        <div class="tree-node" style="margin-left: {node.indent * 20}px">
          <span class="node-bullet">•</span>
          <span class="node-text">{node.text}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .hierarchy-tree {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
    margin-top: 10px;
  }

  .hierarchy-tree h3 {
    font-size: 0.9rem;
    margin-bottom: 10px;
    color: var(--text-primary);
  }

  .tree {
    font-family: 'Consolas', monospace;
    font-size: 0.85rem;
  }

  .tree-node {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0;
    border-left: 1px solid var(--border);
  }

  .node-bullet {
    color: var(--accent);
    flex-shrink: 0;
  }

  .node-text {
    color: var(--text-primary);
    word-break: break-word;
  }
</style>
