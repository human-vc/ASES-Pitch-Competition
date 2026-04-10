"use client";

import { useMemo } from "react";
import { sankey, sankeyLinkHorizontal, sankeyJustify } from "d3-sankey";
import type { DashboardData } from "./types";
import { communityLabel } from "./communityLabel";

interface Props {
  data: DashboardData;
  width: number;
  height: number;
  selectedCluster?: number | null;
  selectedCommunity?: number | null;
  onSelectCluster?: (id: number) => void;
  onSelectCommunity?: (id: number) => void;
  onClearAll?: () => void;
}

const VERDICT_COLOR: Record<string, string> = {
  campaign: "#FF3B3B",
  uncertain: "#FFB800",
  organic: "#00D26A",
};

const COMM_COLORS = ["#FF3B3B", "#F97316", "#C792EA", "#FFB800", "#00D26A"];

export default function SankeyPanel({
  data,
  width,
  height,
  selectedCluster,
  selectedCommunity,
  onSelectCluster,
  onSelectCommunity,
  onClearAll,
}: Props) {
  const layout = useMemo(() => {
    // Build sankey: SOURCE → CLUSTER (ALL) → COMMUNITY → VERDICT
    // Source levels: just 1 source node ("comments")
    // Cluster level: ALL clusters by size (largest first)
    // Community level: 4 communities (or "no_community")
    // Verdict level: 3 (manufactured / uncertain / organic)

    const topClusters = [...data.clusters].sort((a, b) => b.n_comments - a.n_comments);

    interface Node {
      name: string;
      kind: "source" | "cluster" | "community" | "verdict";
      color: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }
    const nodes: Node[] = [];
    const nodeIndex: Record<string, number> = {};

    const addNode = (n: Node) => {
      if (nodeIndex[n.name] != null) return nodeIndex[n.name];
      nodeIndex[n.name] = nodes.length;
      nodes.push(n);
      return nodes.length - 1;
    };

    addNode({ name: "ALL COMMENTS", kind: "source", color: "#FFA028" });
    topClusters.forEach((c) =>
      addNode({
        name: `CLUS ${c.cluster_id}`,
        kind: "cluster",
        color: VERDICT_COLOR[c.classification] || "#FFA028",
        cluster_id: c.cluster_id,
      })
    );
    data.communities.forEach((c) =>
      addNode({
        name: communityLabel(c, data),
        kind: "community",
        color: COMM_COLORS[c.community_id % COMM_COLORS.length],
        community_id: c.community_id,
      })
    );
    addNode({ name: "MANUFACTURED", kind: "verdict", color: VERDICT_COLOR.campaign });
    addNode({ name: "UNCERTAIN", kind: "verdict", color: VERDICT_COLOR.uncertain });
    addNode({ name: "ORGANIC", kind: "verdict", color: VERDICT_COLOR.organic });

    // Build cluster → community map by checking which community contains each cluster's labels
    const labels = data.labels;
    const memberCommunities: Record<number, number[]> = {};
    // For each cluster, find which community has the most overlap
    topClusters.forEach((c) => {
      const memberSet = new Set(
        data.comment_ids.filter((_, i) => labels[i] === c.cluster_id)
      );
      const counts: Record<number, number> = {};
      data.communities.forEach((comm) => {
        let overlap = 0;
        comm.members.forEach((mIdx) => {
          if (data.labels[mIdx] === c.cluster_id) overlap++;
        });
        counts[comm.community_id] = overlap;
      });
      // Pick the dominant community (or none)
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      memberCommunities[c.cluster_id] = top && top[1] > 0 ? [parseInt(top[0])] : [];
    });

    // Links
    interface Link {
      source: number;
      target: number;
      value: number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }
    const links: Link[] = [];

    // SOURCE → CLUSTERS (proportional)
    topClusters.forEach((c) => {
      links.push({
        source: nodeIndex["ALL COMMENTS"],
        target: nodeIndex[`CLUS ${c.cluster_id}`],
        value: c.n_comments,
      });
    });

    // CLUSTERS → COMMUNITIES
    topClusters.forEach((c) => {
      const commIds = memberCommunities[c.cluster_id] || [];
      if (commIds.length === 0) {
        // Direct to verdict
        const verdictName =
          c.classification === "campaign"
            ? "MANUFACTURED"
            : c.classification === "uncertain"
            ? "UNCERTAIN"
            : "ORGANIC";
        links.push({
          source: nodeIndex[`CLUS ${c.cluster_id}`],
          target: nodeIndex[verdictName],
          value: c.n_comments,
        });
      } else {
        commIds.forEach((cid) => {
          const comm = data.communities.find((cm) => cm.community_id === cid);
          if (!comm) return;
          links.push({
            source: nodeIndex[`CLUS ${c.cluster_id}`],
            target: nodeIndex[communityLabel(comm, data)],
            value: c.n_comments,
          });
        });
      }
    });

    // COMMUNITIES → VERDICTS (all manufactured by definition)
    data.communities.forEach((c) => {
      links.push({
        source: nodeIndex[communityLabel(c, data)],
        target: nodeIndex["MANUFACTURED"],
        value: c.n_members,
      });
    });

    const sankeyGen = sankey<Node, Link>()
      .nodeWidth(6)
      .nodePadding(1.2)
      .nodeAlign(sankeyJustify)
      .extent([
        [88, 4],
        [width - 110, height - 14],
      ]);

    try {
      const result = sankeyGen({
        nodes: nodes.map((d) => ({ ...d })),
        links: links.map((d) => ({ ...d })),
      });
      return result;
    } catch {
      return null;
    }
  }, [data, width, height]);

  // Resolve which community a cluster belongs to (via dominant overlap) so
  // selecting a community can highlight its child clusters and vice-versa.
  const clusterCommunityMap = useMemo(() => {
    const map = new Map<number, number>();
    data.clusters.forEach((c) => {
      const counts: Record<number, number> = {};
      data.communities.forEach((comm) => {
        let overlap = 0;
        comm.members.forEach((mIdx) => {
          if (data.labels[mIdx] === c.cluster_id) overlap++;
        });
        if (overlap > 0) counts[comm.community_id] = overlap;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted[0]) map.set(c.cluster_id, parseInt(sorted[0][0]));
    });
    return map;
  }, [data]);

  if (!layout) return null;

  const linkPath = sankeyLinkHorizontal();
  const hasSelection = selectedCluster != null || selectedCommunity != null;

  // Decide whether a node is "in focus" given the current selection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeInFocus = (n: any): boolean => {
    if (!hasSelection) return true;
    if (n.kind === "source") return true;
    if (n.kind === "cluster") {
      if (selectedCluster != null && n.cluster_id === selectedCluster) return true;
      if (selectedCommunity != null && clusterCommunityMap.get(n.cluster_id) === selectedCommunity) return true;
      return false;
    }
    if (n.kind === "community") {
      if (selectedCommunity != null && n.community_id === selectedCommunity) return true;
      if (selectedCluster != null && clusterCommunityMap.get(selectedCluster) === n.community_id) return true;
      return false;
    }
    if (n.kind === "verdict") {
      // Always show verdict if anything flows to it from focused chain
      return true;
    }
    return false;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkInFocus = (source: any, target: any): boolean => {
    if (!hasSelection) return true;
    return nodeInFocus(source) && nodeInFocus(target);
  };

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="dl-svg"
      style={{ display: "block" }}
    >
      {/* Links */}
      {layout.links.map((link, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const source = link.source as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = link.target as any;
        const color = source.color || "#FFA028";
        const focused = linkInFocus(source, target);
        return (
          <path
            key={i}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            d={linkPath(link as any) || ""}
            fill="none"
            stroke={color}
            strokeOpacity={focused ? (hasSelection ? 0.65 : 0.35) : 0.05}
            strokeWidth={Math.max(1, link.width || 1)}
          />
        );
      })}
      {/* Nodes */}
      {layout.nodes.map((node, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const n = node as any;
        const nodeH = Math.max(1, n.y1 - n.y0);
        const showLabel =
          n.kind === "source" ||
          n.kind === "verdict" ||
          n.kind === "community" ||
          nodeH >= 6;
        const focused = nodeInFocus(n);
        const isSel =
          (n.kind === "cluster" && n.cluster_id === selectedCluster) ||
          (n.kind === "community" && n.community_id === selectedCommunity);
        const clickable =
          n.kind === "cluster" || n.kind === "community" || n.kind === "source";
        return (
          <g
            key={i}
            onClick={() => {
              if (n.kind === "cluster" && onSelectCluster) {
                onSelectCluster(n.cluster_id);
              } else if (n.kind === "community" && onSelectCommunity) {
                onSelectCommunity(n.community_id);
              } else if (n.kind === "source" && onClearAll) {
                onClearAll();
              }
            }}
            style={{ cursor: clickable ? "pointer" : "default" }}
          >
            <rect
              x={n.x0}
              y={n.y0}
              width={n.x1 - n.x0}
              height={nodeH}
              fill={n.color}
              opacity={focused ? 1 : 0.18}
              stroke={isSel ? "#FFFFFF" : "none"}
              strokeWidth={isSel ? 1.4 : 0}
            />
            {/* Larger invisible hit target for clusters (which are tiny) */}
            {clickable && (
              <rect
                x={n.x0 - 4}
                y={n.y0 - 1}
                width={n.x1 - n.x0 + 8}
                height={nodeH + 2}
                fill="transparent"
              />
            )}
            {showLabel && n.kind !== "verdict" && (
              <text
                x={n.x1 + 3}
                y={(n.y0 + n.y1) / 2}
                dy="0.35em"
                textAnchor="start"
                fontSize={n.kind === "cluster" ? 5 : n.kind === "source" ? 8 : 7}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight={n.kind === "cluster" ? (isSel ? 800 : 600) : 700}
                fill={isSel ? "#FFFFFF" : n.color}
                opacity={focused ? 1 : 0.3}
                style={{ pointerEvents: "none" }}
              >
                {n.name}
              </text>
            )}
            {/* Verdict labels — rotated 90° so they sit vertically against the bar */}
            {showLabel && n.kind === "verdict" && (
              <text
                x={(n.x0 + n.x1) / 2}
                y={(n.y0 + n.y1) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="7"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="700"
                fill={isSel ? "#FFFFFF" : n.color}
                opacity={focused ? 1 : 0.3}
                transform={`rotate(-90, ${(n.x0 + n.x1) / 2}, ${(n.y0 + n.y1) / 2})`}
                style={{ pointerEvents: "none" }}
              >
                {n.name}
              </text>
            )}
            {/* Source node — show "CLICK TO RESET" hint when filtered */}
            {n.kind === "source" && hasSelection && (
              <text
                x={n.x0 + (n.x1 - n.x0) / 2}
                y={n.y1 + 9}
                textAnchor="middle"
                fontSize="6"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="700"
                fill="#00B4D8"
                style={{ pointerEvents: "none" }}
              >
                ▸ CLICK TO SELECT ALL
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
