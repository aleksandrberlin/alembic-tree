# Changelog

All notable changes to the "Alembic Migration Tree" extension will be documented in this file.

## [0.0.1] - 2026-02-27

### Added

- Sidebar tree view showing the full migration chain from base to head
- Interactive DAG graph view powered by Cytoscape.js and dagre layout
- Search by revision hash or filename in the graph view
- Head node highlighting with distinct color and background tint
- "Focus Latest Head" button to navigate to current heads
- Click node to open migration file; Shift+Click to copy revision hash
- Expand All command to fully expand the sidebar tree
- Configurable versions directory path (`alembicTree.versionsPath`)
- Detection of merge migrations, missing parent revisions, and branch points
