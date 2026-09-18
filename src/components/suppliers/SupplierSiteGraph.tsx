"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { IssueBadge } from "@/components/ui";
import type { SupplierGroup } from "@/lib/suppliers/group";
import { siteIssuesFor, supplierIssuesFor } from "@/lib/suppliers/group";
import type { SupplierIssue, SupplierRecord } from "@/lib/suppliers/types";

export type GraphFocus = { kind: "supplier" } | { kind: "site"; siteId: string };

type SupplierNodeData = {
  name: string;
  number: string;
  issues: SupplierIssue[];
  selected: boolean;
  inactive: boolean;
};

type SiteNodeData = {
  siteCode: string;
  city: string;
  country: string;
  issues: SupplierIssue[];
  selected: boolean;
  inactive: boolean;
};

type GraphNode = Node<SupplierNodeData, "supplier"> | Node<SiteNodeData, "site">;

function issueTypes(issues: SupplierIssue[]): string[] {
  return [...new Set(issues.map((i) => i.type))];
}

function SupplierFlowNode({ data }: NodeProps<Node<SupplierNodeData, "supplier">>) {
  return (
    <div
      className={`w-[13.5rem] rounded-lg border bg-white px-3 py-2 shadow-sm ${
        data.selected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200"
      }`}
    >
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
        Supplier{data.inactive ? " · inactive" : ""}
      </div>
      <div className="truncate text-sm font-semibold text-slate-900" title={data.name}>
        {data.name}
      </div>
      <div className="truncate text-[11px] text-slate-500">{data.number}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {data.issues.length === 0 ? (
          <span className="text-[10px] text-emerald-700">Clean</span>
        ) : (
          issueTypes(data.issues).map((t) => <IssueBadge key={t} type={t} />)
        )}
      </div>
    </div>
  );
}

function SiteFlowNode({ data }: NodeProps<Node<SiteNodeData, "site">>) {
  return (
    <div
      className={`w-[13.5rem] rounded-lg border bg-white px-3 py-2 shadow-sm ${
        data.selected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-slate-200"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Site{data.inactive ? " · inactive" : ""}
      </div>
      <div className="truncate text-sm font-semibold text-slate-900">{data.siteCode || "—"}</div>
      <div className="truncate text-[11px] text-slate-500">
        {data.city || "—"} {data.country || ""}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {data.issues.length === 0 ? (
          <span className="text-[10px] text-emerald-700">Clean</span>
        ) : (
          issueTypes(data.issues).map((t) => <IssueBadge key={t} type={t} />)
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  supplier: SupplierFlowNode,
  site: SiteFlowNode,
};

function buildGraph(
  group: SupplierGroup,
  sites: SupplierRecord[],
  focus: GraphFocus,
): { nodes: GraphNode[]; edges: Edge[] } {
  const supplierIssues = supplierIssuesFor(sites.length ? sites : group.records);
  const supplierY = Math.max(0, ((sites.length - 1) * 108) / 2);
  const nodes: GraphNode[] = [
    {
      id: `supplier:${group.supplier.id}`,
      type: "supplier",
      position: { x: 16, y: supplierY },
      data: {
        name: group.supplier.name,
        number: group.supplier.supplierNumber,
        issues: supplierIssues,
        selected: focus.kind === "supplier",
        inactive: group.supplier.status === "inactive" || Boolean(group.supplier.inactiveDate),
      },
      draggable: false,
    },
  ];
  const edges: Edge[] = [];
  sites.forEach((record, index) => {
    const id = `site:${record.site.id}`;
    nodes.push({
      id,
      type: "site",
      position: { x: 280, y: index * 108 },
      data: {
        siteCode: record.site.siteCode,
        city: record.site.city,
        country: record.site.country,
        issues: siteIssuesFor(record),
        selected: focus.kind === "site" && focus.siteId === record.site.id,
        inactive: Boolean(record.site.inactiveDate),
      },
      draggable: false,
    });
    edges.push({
      id: `e:${group.supplier.id}:${record.site.id}`,
      source: `supplier:${group.supplier.id}`,
      target: id,
      type: "smoothstep",
    });
  });
  return { nodes, edges };
}

function GraphCanvas({
  group,
  sites,
  focus,
  onFocus,
}: {
  group: SupplierGroup;
  sites: SupplierRecord[];
  focus: GraphFocus;
  onFocus: (focus: GraphFocus) => void;
}) {
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(
    () => buildGraph(group, sites, focus),
    [group, sites, focus],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.18, duration: 200 });
    }, 40);
    return () => window.clearTimeout(id);
  }, [fitView, group.id, sites.length]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_, node) => {
        if (node.id.startsWith("supplier:")) onFocus({ kind: "supplier" });
        if (node.id.startsWith("site:")) onFocus({ kind: "site", siteId: node.id.slice("site:".length) });
      }}
      minZoom={0.4}
      maxZoom={1.4}
    >
      <Background gap={16} color="#e2e8f0" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function SupplierSiteGraph({
  group,
  sites,
  focus,
  onFocus,
}: {
  group: SupplierGroup | null;
  sites: SupplierRecord[];
  focus: GraphFocus;
  onFocus: (focus: GraphFocus) => void;
}) {
  if (!group) {
    return (
      <p className="px-4 py-6 text-sm text-slate-400">
        Select a supplier to see how it links to its sites.
      </p>
    );
  }
  return (
    <ReactFlowProvider>
      <div className="h-full min-h-0 w-full">
        <GraphCanvas group={group} sites={sites} focus={focus} onFocus={onFocus} />
      </div>
    </ReactFlowProvider>
  );
}
