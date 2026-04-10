// Derives a short category label for a coordination community from the dominant
// premise of the clusters it owns. Returns something like "INNOVATION BLOC".

import type { Cluster, Community, DashboardData } from "./types";

interface Rule {
  match: RegExp;
  label: string;
}

// Order matters — first match wins
const CATEGORY_RULES: Rule[] = [
  { match: /innovation|outdated|modern|certainty/i, label: "INNOVATION BLOC" },
  { match: /first amendment|speech|censor|government.*(control|takeover)/i, label: "FREE-SPEECH BLOC" },
  { match: /free market|consumer|competition|market.*regulat/i, label: "FREE-MARKET BLOC" },
  { match: /light.?touch|deregulat|regulatory.*(uncertainty|burden)|title ii.*(creates|imposes)/i, label: "DEREG BLOC" },
  { match: /broadband|invest|infrastructure/i, label: "INVESTMENT BLOC" },
  { match: /privacy|data|surveillance/i, label: "PRIVACY BLOC" },
];

function pickPremise(community: Community, data: DashboardData): string {
  const clusterIds = new Set<number>();
  community.members.forEach((idx) => {
    const lbl = data.labels[idx];
    if (lbl !== -1) clusterIds.add(lbl);
  });
  const memberClusters = data.clusters.filter((c: Cluster) => clusterIds.has(c.cluster_id));
  const premiseTally: Record<string, number> = {};
  memberClusters.forEach((cl) => {
    const p = cl.argument_identity?.top_premises?.[0];
    if (p) premiseTally[p] = (premiseTally[p] || 0) + cl.n_comments;
  });
  return Object.entries(premiseTally).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

export function communityLabel(community: Community, data: DashboardData): string {
  const premise = pickPremise(community, data);
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(premise)) return rule.label;
  }
  // Fallback: first 2 meaningful words from premise, uppercased
  const words = premise
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(the|that|this|with|from|into|over|when|which|their|have|been|will|than|such)$/i.test(w))
    .slice(0, 2)
    .join(" ")
    .toUpperCase();
  return words || `BLOC ${community.community_id + 1}`;
}

export function communityShortCode(community: Community, data: DashboardData): string {
  // Compact 3-4 letter code for nodes that can't fit a full label
  const full = communityLabel(community, data);
  const first = full.split(/\s+/)[0] || "";
  return first.slice(0, 4);
}
