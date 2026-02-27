# Alembic Migration Tree

Visualize your [Alembic](https://alembic.sqlalchemy.org/) migration history as an interactive tree view and DAG graph directly in VS Code.

## Features

**Sidebar tree view** -- Browse your migration chain from base to head. Migrations are displayed chronologically (base at the top, heads at the bottom). Merge migrations and branches are clearly labeled. Click any node to open the migration file.

**Interactive graph view** -- A full DAG visualization of your migration history using Cytoscape.js. Includes:

- Zoom, pan, and drag
- Search by revision hash or filename
- Head nodes highlighted with a distinct color
- "Focus Latest Head" button to jump to the current head
- Click a node to open the file; Shift+Click to copy the revision hash

**Expand All** -- Expand the entire migration tree in the sidebar with one click.

## Getting Started

1. Open a workspace that contains an Alembic `versions/` directory
2. The "Alembic Tree" icon appears in the activity bar
3. Click it to see the migration tree

The extension scans `migrations/versions/` by default. If your versions directory is elsewhere, configure it:

## Settings

| Setting | Default | Description |
|---|---|---|
| `alembicTree.versionsPath` | `migrations/versions` | Path (relative to workspace root) to the Alembic versions directory |

## Commands

All commands are available from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---|---|
| Alembic Tree: Refresh | Rescan migration files and rebuild the tree |
| Alembic Tree: Open Graph | Open the interactive DAG graph view |
| Alembic Tree: Expand All | Expand every node in the sidebar tree |

## Requirements

- VS Code 1.85.0 or later
- A workspace containing Alembic migration files (Python files with `revision` and `down_revision` variables)

## License

[MIT](LICENSE)
