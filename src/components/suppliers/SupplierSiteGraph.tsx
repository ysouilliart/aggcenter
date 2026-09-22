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
import { brand } from "@/components/theme";
import type { SupplierGroup } from "@/lib/suppliers/group";
import { siteIssuesFor, siteOperatingUnits, supplierIssuesFor } from "@/lib/suppliers/group";
import type { SiteOperatingUnit, SupplierIssue, SupplierRecord } from "@/lib/suppliers/types";

export type GraphFocus = { kind: "supplier" } | { kind: "site"; siteId: string };

type SupplierNodeData = {
  name: string;
  number: string;
  vendorId: string;
  issues: SupplierIssue[];
  selected: boolean;
  inactive: boolean;
};

type SiteNodeData = {
  siteId: string;
  siteCode: string;
  city: string;
  country: string;
  terms: string;
  operatingUnits: SiteOperatingUnit[];
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
      className={`w-[16rem] rounded-lg border bg-white px-3 py-2 shadow-sm ${
        data.selected ? "border-brand ring-2 ring-brand-soft" : "border-slate-200"
      }`}
    >
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-brand">
        Supplier{data.inactive ? " · inactive" : ""}
      </div>
      <div className="truncate text-[13px] font-medium text-slate-900" title={data.name}>
        {data.name}
      </div>
      <div className="truncate text-[11px] text-slate-500">{data.number}</div>
      <div className="truncate font-mono text-[11px] text-slate-500" title={data.vendorId}>
        VID {data.vendorId}
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

function OuTags({ units }: { units: SiteOperatingUnit[] }) {
  if (units.length === 0) {
    return <span className="text-[10px] text-slate-400">No operating unit</span>;
  }
  return (
    <>
      {units.map((ou) => {
        const key = `${ou.name}|${ou.orgId}`;
        const name = ou.name || "Operating unit";
        return (
          <span
            key={key}
            className="flex max-w-full flex-col rounded bg-slate-100 px-1.5 py-0.5 text-[10px] leading-tight text-slate-700"
            title={ou.orgId ? `${name} · OU ID ${ou.orgId}` : name}
          >
            <span className="truncate font-medium">{name}</span>
            {ou.orgId ? (
              <span className="font-mono text-slate-500">OU ID {ou.orgId}</span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

function SiteFlowNode({ data }: NodeProps<Node<SiteNodeData, "site">>) {
  return (
    <div
      className={`w-[16rem] rounded-lg border bg-white px-3 py-2 shadow-sm ${
        data.selected ? "border-brand ring-2 ring-brand-soft" : "border-slate-200"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Site{data.inactive ? " · inactive" : ""}
      </div>
      <div className="truncate text-[13px] font-medium text-slate-900">{data.siteCode || "—"}</div>
      <div className="truncate font-mono text-[11px] text-slate-500" title={data.siteId}>
        SID {data.siteId}
      </div>
      <div className="truncate text-[11px] text-slate-500">
        {data.terms || `${data.city || "—"} ${data.country || ""}`.trim()}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <OuTags units={data.operatingUnits} />
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

function siteNodeHeight(record: SupplierRecord): number {
  const units = Math.max(1, siteOperatingUnits(record.site).length);
  const issueRows = siteIssuesFor(record).length > 2 ? 2 : 1;
  return 124 + units * 32 + issueRows * 22;
}

function buildGraph(
  group: SupplierGroup,
  sites: SupplierRecord[],
  focus: GraphFocus,
): { nodes: GraphNode[]; edges: Edge[] } {
  const supplierIssues = supplierIssuesFor(sites.length ? sites : group.records);
  const edges: Edge[] = [];
  const siteNodes: GraphNode[] = [];
  let y = 0;
  sites.forEach((record) => {
    const id = `site:${record.site.id}`;
    const height = siteNodeHeight(record);
    siteNodes.push({
      id,
      type: "site",
      position: { x: 340, y },
      data: {
        siteId: record.site.id,
        siteCode: record.site.siteCode.trim() || record.site.city.trim() || "Site",
        city: record.site.city,
        country: record.site.country,
        terms: record.site.paymentTerms || `${record.site.city} ${record.site.country}`.trim(),
        operatingUnits: siteOperatingUnits(record.site),
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
      style: { stroke: brand.blue, strokeWidth: 1.5 },
    });
    y += height + 16;
  });
  const supplierY = Math.max(0, (Math.max(y - 16, 120) - 120) / 2);
  const nodes: GraphNode[] = [
    {
      id: `supplier:${group.supplier.id}`,
      type: "supplier",
      position: { x: 16, y: supplierY },
      data: {
        name: group.supplier.name,
        number: group.supplier.supplierNumber,
        vendorId: group.supplier.id,
        issues: supplierIssues,
        selected: focus.kind === "supplier",
        inactive: group.supplier.status === "inactive" || Boolean(group.supplier.inactiveDate),
      },
      draggable: false,
    },
    ...siteNodes,
  ];
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
      defaultEdgeOptions={{ style: { stroke: brand.blue, strokeWidth: 1.5 } }}
    >
      <Background gap={16} color={brand.line} />
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
