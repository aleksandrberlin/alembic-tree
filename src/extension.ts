import * as vscode from "vscode";
import { AlembicMigrationsProvider } from "./alembicTree";
import { openMigrationGraphWebview } from "./graphView";

export function activate(context: vscode.ExtensionContext) {
    const provider = new AlembicMigrationsProvider();

    const treeView = vscode.window.createTreeView("alembicMigrationsView", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(treeView, provider);

    context.subscriptions.push(
        vscode.commands.registerCommand("alembicTree.refresh", async () => {
            await provider.rebuildGraph();
            provider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("alembicTree.openGraph", async () => {
            await provider.rebuildGraph();
            const graph = provider.getGraphData();
            openMigrationGraphWebview(context, graph, "Alembic Migration Graph");
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("alembicTree.expandAll", async () => {
            await provider.rebuildGraph();
            provider.refresh();

            await new Promise((r) => setTimeout(r, 0));

            const baseRevs = provider.getBaseRevisions();
            for (const rev of baseRevs) {
                const item = provider.getTreeItemForRevision(rev);
                await treeView.reveal(item, { expand: 999, focus: false, select: false });
            }
        }),
    );

    provider.rebuildGraph().then(
        () => provider.refresh(),
        (err) => provider.out.appendLine(`Initial build failed: ${err}`),
    );
}

export function deactivate() {}
