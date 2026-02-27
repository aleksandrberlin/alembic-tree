import * as vscode from "vscode";
import * as path from "path";

type RevisionId = string;

interface MigrationNode {
    revision: RevisionId;
    downRevisions: RevisionId[];
    filePath: string;
    label: string;
}

export interface GraphDataResult {
    nodes: Map<string, MigrationNode>;
    edges: Array<{ from: string; to: string }>;
    bases: Set<string>;
    heads: Set<string>;
}

function uniq<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

function stripInlineComment(s: string): string {
    // remove trailing inline comments:  down_revision = "x"  # comment
    return s.replace(/\s+#.*$/g, "").trim();
}

function normalizeRhs(rhs: string): string {
    return stripInlineComment(rhs).replace(/\s+/g, " ").trim();
}

function asArrayDownRevision(raw: string | null): string[] {
    if (!raw) {
        return [];
    }

    const normalized = normalizeRhs(raw);

    if (/^(None|null)$/i.test(normalized)) {
        return [];
    }

    const mStr = normalized.match(/^['"]([^'"]+)['"]$/);
    if (mStr) {
        return [mStr[1]];
    }

    // Tuple/list: extract all quoted tokens
    const tokens = [...normalized.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (tokens.length > 0) {
        return tokens;
    }

    // Fallback: bare identifier
    if (/^[0-9a-zA-Z_]+$/.test(normalized)) {
        return [normalized];
    }

    return [];
}

function parseRevision(raw: string): string {
    const normalized = normalizeRhs(raw);

    const mStr = normalized.match(/^['"]([^'"]+)['"]$/);
    if (mStr) {
        return mStr[1];
    }

    return normalized.replace(/^['"]|['"]$/g, "").trim();
}

function parseMigrationFile(content: string, filePath: string): MigrationNode | null {
    // Supports both:  revision = "abc"  /  revision: str = "abc"
    const revMatch = content.match(/^\s*revision\s*(?::\s*[^=]+)?\s*=\s*(.+)\s*$/m);
    const downMatch = content.match(/^\s*down_revision\s*(?::\s*[^=]+)?\s*=\s*(.+)\s*$/m);

    if (!revMatch) {
        return null;
    }

    const revision = parseRevision(revMatch[1]);
    const downRevisions = asArrayDownRevision(downMatch ? downMatch[1] : null);
    const base = path.basename(filePath, path.extname(filePath));

    return { revision, downRevisions, filePath, label: `${revision} (${base})` };
}

export class AlembicTreeItem extends vscode.TreeItem {
    constructor(
        public readonly nodeId: string,
        public readonly labelText: string,
        public readonly filePath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly descriptionText?: string,
    ) {
        super(labelText, collapsibleState);
        this.tooltip = filePath ? `${labelText}\n${filePath}` : labelText;
        this.description = descriptionText;

        if (filePath) {
            const uri = vscode.Uri.file(filePath);
            this.resourceUri = uri;
            this.command = {
                command: "vscode.open",
                title: "Open Migration",
                arguments: [uri],
            };
        }
    }
}

export class AlembicMigrationsProvider implements vscode.TreeDataProvider<AlembicTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AlembicTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    public readonly out: vscode.OutputChannel;

    private nodesByRevision = new Map<RevisionId, MigrationNode>();
    private childrenByParent = new Map<RevisionId, RevisionId[]>();
    private itemCache = new Map<string, AlembicTreeItem>();

    private bases: RevisionId[] = [];
    private heads: RevisionId[] = [];
    private missingParents: RevisionId[] = [];

    constructor() {
        this.out = vscode.window.createOutputChannel("Alembic Tree");
    }

    dispose() {
        this._onDidChangeTreeData.dispose();
        this.out.dispose();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    public getBaseRevisions(): RevisionId[] {
        return this.bases;
    }

    public getTreeItemForRevision(rev: string): AlembicTreeItem {
        const key = `rev:${rev}`;
        const cached = this.itemCache.get(key);
        if (cached) {
            return cached;
        }

        const n = this.nodesByRevision.get(rev);
        const label = n ? n.label : rev;
        const filePath = n ? n.filePath : "";
        const children = this.childrenByParent.get(rev) ?? [];
        const collapsible =
            children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

        const item = new AlembicTreeItem(key, label, filePath, collapsible, "migration");
        this.itemCache.set(key, item);
        return item;
    }

    async rebuildGraph(): Promise<void> {
        this.itemCache.clear();
        this.nodesByRevision.clear();
        this.childrenByParent.clear();
        this.bases = [];
        this.heads = [];
        this.missingParents = [];

        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            this.out.appendLine("No workspace folder open");
            return;
        }

        const config = vscode.workspace.getConfiguration("alembicTree");
        const versionsPath = config.get<string>("versionsPath", "migrations/versions");
        const relPosix = versionsPath.replace(/\\/g, "/");
        const pattern = new vscode.RelativePattern(ws, path.posix.join(relPosix, "**/*.py"));

        this.out.appendLine(`Scanning ${versionsPath}`);

        let files: vscode.Uri[];
        try {
            files = await vscode.workspace.findFiles(pattern, "**/{__pycache__}/**");
        } catch (e: unknown) {
            this.out.appendLine(`findFiles error: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }

        this.out.appendLine(`Found ${files.length} files`);

        const parsed: MigrationNode[] = [];
        for (const f of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(f);
                const node = parseMigrationFile(doc.getText(), f.fsPath);
                if (node) {
                    parsed.push(node);
                } else {
                    this.out.appendLine(`Skipped (no revision): ${f.fsPath}`);
                }
            } catch (e: unknown) {
                this.out.appendLine(`Failed to read ${f.fsPath}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        for (const n of parsed) {
            this.nodesByRevision.set(n.revision, n);
        }

        for (const n of parsed) {
            for (const parent of n.downRevisions) {
                const existing = this.childrenByParent.get(parent) ?? [];
                existing.push(n.revision);
                this.childrenByParent.set(parent, existing);
            }
        }

        for (const [k, v] of this.childrenByParent.entries()) {
            this.childrenByParent.set(k, uniq(v).sort());
        }

        // Compute bases, heads, missing parents once
        const referencedAsParent = new Set<RevisionId>();
        const missingSet = new Set<RevisionId>();

        for (const n of this.nodesByRevision.values()) {
            for (const p of n.downRevisions) {
                referencedAsParent.add(p);
                if (!this.nodesByRevision.has(p)) {
                    missingSet.add(p);
                }
            }
        }

        this.bases = [...this.nodesByRevision.values()]
            .filter((n) => n.downRevisions.length === 0)
            .map((n) => n.revision)
            .sort();

        this.heads = [...this.nodesByRevision.keys()].filter((r) => !referencedAsParent.has(r)).sort();

        this.missingParents = [...missingSet].sort();

        this.out.appendLine(
            `Parsed: ${parsed.length}, bases: ${this.bases.length}, ` +
                `heads: ${this.heads.length}, missing: ${this.missingParents.length}`,
        );
    }

    public getGraphData(): GraphDataResult {
        const edges: Array<{ from: string; to: string }> = [];

        for (const n of this.nodesByRevision.values()) {
            for (const parent of n.downRevisions) {
                edges.push({ from: parent, to: n.revision });
            }
        }

        return {
            nodes: this.nodesByRevision,
            edges,
            bases: new Set(this.bases),
            heads: new Set(this.heads),
        };
    }

    // -- TreeDataProvider implementation --

    getTreeItem(element: AlembicTreeItem): vscode.TreeItem {
        return element;
    }

    getParent(element: AlembicTreeItem): AlembicTreeItem | undefined {
        if (element.nodeId === "missingParents") {
            return undefined;
        }

        if (element.nodeId.startsWith("missing:")) {
            return this.getMissingParentsGroupItem();
        }

        const rev = element.nodeId.startsWith("rev:") ? element.nodeId.slice(4) : element.nodeId;
        const node = this.nodesByRevision.get(rev);
        if (!node || node.downRevisions.length === 0) {
            return undefined;
        }

        return this.getTreeItemForRevision(node.downRevisions[0]);
    }

    async getChildren(element?: AlembicTreeItem): Promise<AlembicTreeItem[]> {
        if (this.nodesByRevision.size === 0) {
            await this.rebuildGraph();
        }

        if (!element) {
            return this.getRootChildren();
        }

        if (element.nodeId === "missingParents") {
            return this.missingParents.map(
                (p) =>
                    new AlembicTreeItem(
                        `missing:${p}`,
                        p,
                        "",
                        vscode.TreeItemCollapsibleState.None,
                        "missing",
                        "not found",
                    ),
            );
        }

        return this.getRevisionChildren(element);
    }

    // -- Private helpers --

    private getMissingParentsGroupItem(): AlembicTreeItem {
        const key = "missingParents";
        const cached = this.itemCache.get(key);
        if (cached) {
            return cached;
        }

        const item = new AlembicTreeItem(
            key,
            "Missing parent revisions",
            "",
            vscode.TreeItemCollapsibleState.Collapsed,
            "group",
            `${this.missingParents.length}`,
        );
        this.itemCache.set(key, item);
        return item;
    }

    private getRootChildren(): AlembicTreeItem[] {
        const items: AlembicTreeItem[] = this.bases.map((rev) => {
            const n = this.nodesByRevision.get(rev)!;
            const children = this.childrenByParent.get(rev) ?? [];
            return new AlembicTreeItem(
                `rev:${rev}`,
                n.label,
                n.filePath,
                children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                "migration",
                "base",
            );
        });

        if (this.missingParents.length > 0) {
            items.unshift(this.getMissingParentsGroupItem());
        }

        return items;
    }

    private getRevisionChildren(element: AlembicTreeItem): AlembicTreeItem[] {
        const rev = element.nodeId.startsWith("rev:") ? element.nodeId.slice(4) : element.nodeId;
        const childRevs = this.childrenByParent.get(rev) ?? [];

        return childRevs
            .map((cr) => {
                const n = this.nodesByRevision.get(cr);

                if (!n) {
                    return new AlembicTreeItem(
                        `rev:${cr}`,
                        cr,
                        "",
                        vscode.TreeItemCollapsibleState.None,
                        "migration",
                        "missing file",
                    );
                }

                const children = this.childrenByParent.get(cr) ?? [];
                const isMerge = n.downRevisions.length > 1;
                const label = isMerge ? `${n.label} [merge]` : n.label;
                const desc = n.downRevisions.length ? `down: ${n.downRevisions.join(", ")}` : "base";

                return new AlembicTreeItem(
                    `rev:${cr}`,
                    label,
                    n.filePath,
                    children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    "migration",
                    desc,
                );
            })
            .sort((a, b) => a.labelText.localeCompare(b.labelText));
    }
}
