"use client";

import React, { useState, useMemo } from "react";
import {
  ClusterState,
  ClusterNode,
  Pod,
  ReplicaSet,
  Deployment,
  DaemonSet,
  StatefulSet,
  Job,
  CronJob,
  Service,
  ServicePort,
} from "@/engine/cluster-state";
import TrafficAnimation from "@/components/TrafficAnimation";

export interface DataPlaneViewProps {
  clusterState: ClusterState;
  nodes?: ClusterNode[];
  className?: string;
}

interface WorkerNodeInfo {
  id: string;
  name: string;
  role: string;
  status: "Ready" | "NotReady";
  ip: string;
  podCidr: string;
  kubeletVersion: string;
  criRuntime: string;
  cniPlugin: string;
  cpuCapacity: string;
  memCapacity: string;
}

const DEFAULT_WORKER_NODES: WorkerNodeInfo[] = [
  {
    id: "worker-node-1",
    name: "worker-node-1",
    role: "Worker / Data Plane",
    status: "Ready",
    ip: "172.18.0.2",
    podCidr: "10.244.1.0/24",
    kubeletVersion: "v1.31.0",
    criRuntime: "containerd://1.7.2",
    cniPlugin: "cni0 bridge (10.244.1.1) • vxlan",
    cpuCapacity: "2000m",
    memCapacity: "4.0 GiB",
  },
  {
    id: "worker-node-2",
    name: "worker-node-2",
    role: "Worker / Data Plane",
    status: "Ready",
    ip: "172.18.0.3",
    podCidr: "10.244.2.0/24",
    kubeletVersion: "v1.31.0",
    criRuntime: "containerd://1.7.2",
    cniPlugin: "cni0 bridge (10.244.2.1) • vxlan",
    cpuCapacity: "2000m",
    memCapacity: "4.0 GiB",
  },
];

export default function DataPlaneView({
  clusterState,
  nodes: propNodes,
  className = "",
}: DataPlaneViewProps) {
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState<string | null>(null);
  const [viewLayout, setViewLayout] = useState<"grid" | "stacked">("grid");
  const [expandedNodeDetails, setExpandedNodeDetails] = useState<Record<string, boolean>>({});
  const [showTrafficVisualizer, setShowTrafficVisualizer] = useState<boolean>(false);

  // Helper to format service ports
  const formatServicePortDisplay = (ports: string | ServicePort[] | undefined) => {
    if (!ports) return "80/TCP";
    if (typeof ports === "string") return ports;
    if (Array.isArray(ports)) {
      return ports
        .map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol || "TCP"}`)
        .join(", ");
    }
    return "80/TCP";
  };

  // Helper to extract primary port number for endpoint mapping
  const getPrimaryPort = (ports: string | ServicePort[] | undefined): string => {
    if (!ports) return "80";
    if (Array.isArray(ports) && ports.length > 0) {
      return String(ports[0].port);
    }
    if (typeof ports === "string") {
      return ports.split(":")[0].split("/")[0];
    }
    return "80";
  };

  // Normalize worker nodes list
  const workerNodesList = useMemo(() => {
    const rawNodes = propNodes || clusterState.nodes;
    if (rawNodes && rawNodes.length > 0) {
      // Filter out control-plane nodes so DataPlaneView focuses purely on worker execution nodes
      const workers = rawNodes.filter(
        (n) => !n.roles.includes("control-plane") && !n.name.includes("control-plane") && !n.name.includes("master")
      );
      if (workers.length > 0) {
        return workers.map((n, idx) => ({
          id: n.name,
          name: n.name,
          role: "Worker / Data Plane",
          status: n.status,
          ip: n.ip || (idx === 0 ? "172.18.0.2" : "172.18.0.3"),
          podCidr: idx === 0 ? "10.244.1.0/24" : "10.244.2.0/24",
          kubeletVersion: "v1.31.0",
          criRuntime: "containerd://1.7.2",
          cniPlugin: `cni0 bridge (10.244.${idx + 1}.1) • vxlan`,
          cpuCapacity: "2000m",
          memCapacity: "4.0 GiB",
        }));
      }
    }
    return DEFAULT_WORKER_NODES;
  }, [propNodes, clusterState.nodes]);

  // Distribute pods across worker nodes
  const { nodePodsMap, allAssignedPods } = useMemo(() => {
    const map: Record<string, Pod[]> = {};
    workerNodesList.forEach((w) => {
      map[w.id] = [];
    });

    const allPods: (Pod & { assignedNode: string; calculatedIp: string })[] = [];
    const podsList = clusterState.pods || [];

    podsList.forEach((pod, index) => {
      let targetNode = workerNodesList[0]?.id || "worker-node-1";

      const explicitNode = pod.node?.toLowerCase() || "";
      if (
        explicitNode.includes("node-2") ||
        explicitNode.includes("node2") ||
        explicitNode.includes("worker-2")
      ) {
        targetNode = workerNodesList[1]?.id || "worker-node-2";
      } else if (
        explicitNode.includes("node-1") ||
        explicitNode.includes("node1") ||
        explicitNode.includes("worker-1")
      ) {
        targetNode = workerNodesList[0]?.id || "worker-node-1";
      } else {
        // Round-robin scheduling simulation across available worker nodes
        const nodeIdx = index % workerNodesList.length;
        targetNode = workerNodesList[nodeIdx]?.id || "worker-node-1";
      }

      // Generate realistic CIDR-matching pod IP if not set
      let podIp = pod.ip;
      if (!podIp || podIp === "10.244.0.5") {
        const nodeIndex = workerNodesList.findIndex((w) => w.id === targetNode);
        const subnetOctet = nodeIndex >= 0 ? String(nodeIndex + 1) : "1";
        const hostOctet = 10 + (index % 50) + 1;
        podIp = `10.244.${subnetOctet}.${hostOctet}`;
      }

      const enrichedPod = {
        ...pod,
        assignedNode: targetNode,
        calculatedIp: podIp,
      };

      if (!map[targetNode]) {
        map[targetNode] = [];
      }
      map[targetNode].push(enrichedPod);
      allPods.push(enrichedPod);
    });

    return { nodePodsMap: map, allAssignedPods: allPods };
  }, [clusterState.pods, workerNodesList]);

  // Calculate dynamic node utilization based on pod counts
  const getNodeMetrics = (nodeId: string, podCount: number) => {
    const baseCpuPercent = 14;
    const baseMemPercent = 26;
    const cpuPerPod = 9;
    const memPerPod = 12;

    const cpuPct = Math.min(94, baseCpuPercent + podCount * cpuPerPod);
    const memPct = Math.min(96, baseMemPercent + podCount * memPerPod);

    const cpuMillis = Math.round((cpuPct / 100) * 2000);
    const memGiB = ((memPct / 100) * 4.0).toFixed(1);

    return {
      cpuPct,
      memPct,
      cpuMillis: `${cpuMillis}m / 2000m`,
      memGiB: `${memGiB} / 4.0 GiB`,
    };
  };

  const toggleNodeDetails = (nodeId: string) => {
    setExpandedNodeDetails((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  // Find endpoints matching services
  const getEndpointsForService = (svc: Service) => {
    const port = getPrimaryPort(svc.ports);
    const matchingPods = allAssignedPods.filter((p) => {
      if (p.status !== "Running") return false;
      if (!svc.selector || Object.keys(svc.selector).length === 0) return true;
      return (
        p.name.toLowerCase().includes(svc.name.toLowerCase()) ||
        svc.name.toLowerCase().includes(p.name.toLowerCase()) ||
        p.image.toLowerCase().includes(svc.name.toLowerCase()) ||
        (p.labels && Object.entries(svc.selector).every(([k, v]) => p.labels?.[k] === v))
      );
    });

    const targetPods = matchingPods.length > 0 ? matchingPods : allAssignedPods.slice(0, 4);

    return targetPods.map((p) => ({
      podName: p.name,
      endpoint: `${p.calculatedIp}:${port}`,
      node: p.assignedNode,
    }));
  };

  return (
    <div className={`space-y-5 ${className}`}>
      {/* ================= WORKLOAD HIERARCHY / OWNERSHIP TREE ================= */}
      {(clusterState.deployments?.length > 0 ||
        clusterState.replicaSets?.length > 0 ||
        clusterState.daemonSets?.length > 0 ||
        clusterState.statefulSets?.length > 0 ||
        clusterState.jobs?.length > 0) && (
        <div className="rounded-xl border border-indigo-500/30 bg-[#0b152b]/90 p-3.5 shadow-lg backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-base">🌳</span>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-200">
                  Workload Ownership & Controller Hierarchy
                </h4>
                <p className="text-[10px] text-slate-400">
                  Controllers declare intent ➔ Pods are materialized across Worker Nodes
                </p>
              </div>
            </div>

            {selectedOwnerFilter && (
              <button
                onClick={() => setSelectedOwnerFilter(null)}
                className="text-[10px] font-mono text-indigo-300 hover:text-white bg-indigo-900/60 px-2 py-0.5 rounded border border-indigo-700/50 flex items-center gap-1 transition-colors"
              >
                <span>✕ Clear Filter</span>
                <span className="text-slate-400">({selectedOwnerFilter})</span>
              </button>
            )}
          </div>

          {/* Workload Badges */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
            {/* Deployments */}
            {clusterState.deployments?.map((dep, idx) => {
              const isSelected = selectedOwnerFilter === dep.name;
              return (
                <button
                  key={dep.name || idx}
                  onClick={() =>
                    setSelectedOwnerFilter(isSelected ? null : dep.name)
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border transition-all text-[11px] ${
                    isSelected
                      ? "border-blue-400 bg-blue-900/70 text-blue-100 shadow-[0_0_10px_rgba(59,130,246,0.5)] ring-1 ring-blue-400"
                      : "border-blue-700/50 bg-blue-950/40 text-blue-300 hover:border-blue-500/70 hover:bg-blue-900/40"
                  }`}
                >
                  <span>📦</span>
                  <span className="font-bold">Deployment: {dep.name}</span>
                  <span className="rounded bg-blue-900/80 px-1.5 py-0.2 text-[9px] text-blue-200 border border-blue-700/60">
                    {dep.available || dep.replicas}/{dep.replicas} Replicas
                  </span>
                  <span className="text-blue-400 text-[10px]">➔ RS</span>
                </button>
              );
            })}

            {/* ReplicaSets */}
            {clusterState.replicaSets?.map((rs, idx) => {
              const isSelected = selectedOwnerFilter === rs.name;
              return (
                <button
                  key={rs.name || idx}
                  onClick={() =>
                    setSelectedOwnerFilter(isSelected ? null : rs.name)
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border transition-all text-[11px] ${
                    isSelected
                      ? "border-purple-400 bg-purple-900/70 text-purple-100 shadow-[0_0_10px_rgba(168,85,247,0.5)] ring-1 ring-purple-400"
                      : "border-purple-700/50 bg-purple-950/40 text-purple-300 hover:border-purple-500/70 hover:bg-purple-900/40"
                  }`}
                >
                  <span>🔄</span>
                  <span className="font-bold">RS: {rs.name}</span>
                  <span className="rounded bg-purple-900/80 px-1.5 py-0.2 text-[9px] text-purple-200 border border-purple-700/60">
                    {rs.readyReplicas || rs.desiredReplicas} Pods
                  </span>
                </button>
              );
            })}

            {/* DaemonSets */}
            {clusterState.daemonSets?.map((ds, idx) => {
              const isSelected = selectedOwnerFilter === ds.name;
              return (
                <button
                  key={ds.name || idx}
                  onClick={() =>
                    setSelectedOwnerFilter(isSelected ? null : ds.name)
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border transition-all text-[11px] ${
                    isSelected
                      ? "border-amber-400 bg-amber-900/70 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.5)] ring-1 ring-amber-400"
                      : "border-amber-700/50 bg-amber-950/40 text-amber-300 hover:border-amber-500/70 hover:bg-amber-900/40"
                  }`}
                >
                  <span>👻</span>
                  <span className="font-bold">DaemonSet: {ds.name}</span>
                  <span className="rounded bg-amber-900/80 px-1.5 py-0.2 text-[9px] text-amber-200 border border-amber-700/60">
                    1 Pod / Node ({workerNodesList.length} Nodes)
                  </span>
                </button>
              );
            })}

            {/* StatefulSets */}
            {clusterState.statefulSets?.map((sts, idx) => {
              const isSelected = selectedOwnerFilter === sts.name;
              return (
                <button
                  key={sts.name || idx}
                  onClick={() =>
                    setSelectedOwnerFilter(isSelected ? null : sts.name)
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border transition-all text-[11px] ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-900/70 text-indigo-100 shadow-[0_0_10px_rgba(99,102,241,0.5)] ring-1 ring-indigo-400"
                      : "border-indigo-700/50 bg-indigo-950/40 text-indigo-300 hover:border-indigo-500/70 hover:bg-indigo-900/40"
                  }`}
                >
                  <span>💾</span>
                  <span className="font-bold">StatefulSet: {sts.name}</span>
                  <span className="rounded bg-indigo-900/80 px-1.5 py-0.2 text-[9px] text-indigo-200 border border-indigo-700/60">
                    {sts.readyReplicas || sts.replicas} Ordinal Pods
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= MULTI-NODE WORKER CLUSTER VIEW ================= */}
      <div className="space-y-4">
        {/* Section Header with Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/20 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-sm text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
              <span>🖥️</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-200">
                  Data Plane (Multi-Node Visualizer)
                </h3>
                <span className="rounded bg-emerald-950/80 px-2 py-0.2 text-[9px] font-mono font-bold text-emerald-400 border border-emerald-700/50">
                  {workerNodesList.length} Nodes Active
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Physical host execution environments running kubelet, containerd CRI, & CNI
              </p>
            </div>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-1.5 bg-[#0b1424] p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
            <button
              onClick={() => setViewLayout("grid")}
              className={`px-2.5 py-1 rounded transition-colors ${
                viewLayout === "grid"
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ⊞ Side-by-Side
            </button>
            <button
              onClick={() => setViewLayout("stacked")}
              className={`px-2.5 py-1 rounded transition-colors ${
                viewLayout === "stacked"
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              ☰ Stacked
            </button>
          </div>
        </div>

        {/* Nodes Grid / Stack */}
        <div
          className={`grid gap-4 ${
            viewLayout === "grid"
              ? "grid-cols-1 lg:grid-cols-2"
              : "grid-cols-1"
          }`}
        >
          {workerNodesList.map((node) => {
            const rawPods = nodePodsMap[node.id] || [];
            const filteredPods = selectedOwnerFilter
              ? rawPods.filter(
                  (p) =>
                    p.ownerRef?.name === selectedOwnerFilter ||
                    p.name.includes(selectedOwnerFilter)
                )
              : rawPods;

            const metrics = getNodeMetrics(node.id, rawPods.length);
            const isDetailsOpen = !!expandedNodeDetails[node.id];

            return (
              <div
                key={node.id}
                className="group relative flex flex-col rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-[#0a1628] via-[#081120] to-[#060c18] p-4 shadow-xl transition-all duration-300 hover:border-emerald-500/50"
              >
                {/* Glowing Top Node Accent Bar */}
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-500/40 via-teal-400/60 to-cyan-500/40 rounded-t-2xl" />

                {/* Node Header */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" />
                      <h4 className="font-mono text-sm font-bold text-white tracking-wide">
                        {node.name}
                      </h4>
                      <span className="rounded bg-emerald-950/80 px-1.5 py-0.2 text-[9px] font-mono font-bold text-emerald-300 border border-emerald-700/50">
                        {node.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-mono text-slate-400">
                      <span>IP: <strong className="text-slate-200">{node.ip}</strong></span>
                      <span>•</span>
                      <span>Subnet: <strong className="text-teal-300">{node.podCidr}</strong></span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleNodeDetails(node.id)}
                    className="text-[10px] font-mono text-slate-400 hover:text-emerald-300 px-2 py-1 rounded bg-slate-900 border border-slate-800 transition-colors"
                  >
                    {isDetailsOpen ? "▲ Hide Info" : "⚙ Daemons"}
                  </button>
                </div>

                {/* CPU & Memory Utilization Progress Bars */}
                <div className="grid grid-cols-2 gap-3 py-2.5 border-b border-slate-800/80 text-[10px] font-mono">
                  {/* CPU Usage */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-semibold text-slate-300">CPU Load</span>
                      <span className="text-emerald-400 font-bold">{metrics.cpuPct}% ({metrics.cpuMillis})</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${metrics.cpuPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Memory Usage */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-semibold text-slate-300">Memory</span>
                      <span className="text-teal-400 font-bold">{metrics.memPct}% ({metrics.memGiB})</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-500"
                        style={{ width: `${metrics.memPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Kubelet & containerd CRI Runtime Status Box */}
                <div
                  className={`transition-all duration-300 overflow-hidden ${
                    isDetailsOpen ? "max-h-60 py-2.5 opacity-100" : "max-h-0 py-0 opacity-0"
                  }`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl bg-[#050b14] p-3 border border-slate-800/90 text-[10px] font-mono">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        kubelet {node.kubeletVersion}
                      </div>
                      <p className="text-slate-400 text-[9px] leading-tight">
                        Port 10250 • SyncLoop: 10s • Node Heartbeat Active
                      </p>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-teal-300 font-bold">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                        containerd CRI (runc)
                      </div>
                      <p className="text-slate-400 text-[9px] leading-tight">
                        unix:///run/containerd/containerd.sock • cgroups v2
                      </p>
                    </div>

                    <div className="col-span-1 sm:col-span-2 pt-1 border-t border-slate-800/60 flex items-center justify-between text-[9px] text-slate-400">
                      <span>CNI Network: {node.cniPlugin}</span>
                      <span className="text-emerald-400">Kube-Proxy: iptables active</span>
                    </div>
                  </div>
                </div>

                {/* Node Container Bay Header */}
                <div className="flex items-center justify-between pt-2.5 pb-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
                    <span className="text-emerald-400">🐋</span>
                    <span>Container Bay: Scheduled Pods</span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.2 text-[10px] font-mono font-semibold text-slate-300">
                      {filteredPods.length} {filteredPods.length === 1 ? "Pod" : "Pods"}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-slate-500">
                    Linux Sandboxes (netns/cgroups)
                  </span>
                </div>

                {/* Node Container Bay Pod Cards Grid */}
                <div className="flex-1 space-y-2">
                  {filteredPods.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/90 bg-[#050a14]/60 p-5 text-center text-xs font-mono text-slate-500">
                      <div className="text-2xl mb-1 opacity-40">📦</div>
                      <p className="text-slate-400 font-medium">No Pods on {node.name}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        {selectedOwnerFilter
                          ? `No pods matching filter '${selectedOwnerFilter}'`
                          : "Scheduler will place pods here based on resource scoring."}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {filteredPods.map((pod, pIdx) => {
                        const isRunning = pod.status === "Running";
                        const isPending = pod.status === "Pending" || (pod.status as string) === "ContainerCreating";
                        const isTerminating = pod.status === "Terminating";
                        const isCrashLoop = pod.status === "CrashLoopBackOff";

                        return (
                          <div
                            key={pod.name || pIdx}
                            className={`relative rounded-xl border p-2.5 font-mono transition-all duration-200 ${
                              isRunning
                                ? "border-emerald-500/30 bg-[#091726]/90 hover:border-emerald-500/60 shadow-md animate-pod-spawn"
                                : isPending
                                ? "border-amber-500/30 bg-[#171408]/80 hover:border-amber-500/60 animate-pod-creating"
                                : isTerminating
                                ? "border-rose-500/40 bg-[#1a0b10]/80 hover:border-rose-500/70 animate-pod-terminating"
                                : isCrashLoop
                                ? "border-rose-500/40 bg-[#1a0b10]/80 hover:border-rose-500/70"
                                : "border-slate-800 bg-[#0c1322]/60"
                            }`}
                          >
                            {/* Pod Card Top Row */}
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${
                                    isRunning
                                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse"
                                      : isPending
                                      ? "bg-amber-400 animate-ping"
                                      : isCrashLoop
                                      ? "bg-rose-500 animate-bounce"
                                      : "bg-slate-500"
                                  }`}
                                />
                                <span className="font-bold text-xs text-white truncate" title={pod.name}>
                                  {pod.name}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                                    isRunning
                                      ? "bg-emerald-900/80 text-emerald-300 border border-emerald-700/50"
                                      : isPending
                                      ? "bg-amber-900/80 text-amber-300 border border-amber-700/50"
                                      : isCrashLoop
                                      ? "bg-rose-900/80 text-rose-300 border border-rose-700/50"
                                      : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {pod.status}
                                </span>
                              </div>
                            </div>

                            {/* Pod Metadata Details */}
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-slate-300">
                              <div className="truncate">
                                <span className="text-slate-500">Image: </span>
                                <strong className="text-slate-200">{pod.image || "nginx:latest"}</strong>
                              </div>

                              <div className="truncate">
                                <span className="text-slate-500">Pod IP: </span>
                                <strong className="text-teal-300">
                                  {(pod as any).calculatedIp || pod.ip || "10.244.1.10"}
                                </strong>
                              </div>

                              <div className="truncate">
                                <span className="text-slate-500">Port: </span>
                                <strong className="text-slate-200">80/TCP</strong>
                              </div>

                              <div className="truncate">
                                <span className="text-slate-500">Restarts: </span>
                                <strong className={pod.restarts > 0 ? "text-amber-300" : "text-slate-300"}>
                                  {pod.restarts || 0}
                                </strong>
                              </div>
                            </div>

                            {/* Owner Ref & Sandbox Isolation Footer */}
                            <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[9px]">
                              {pod.ownerRef ? (
                                <span className="rounded bg-purple-950/70 px-1.5 py-0.2 font-medium text-purple-300 border border-purple-800/50 truncate max-w-[190px]">
                                  {pod.ownerRef.kind}: {pod.ownerRef.name}
                                </span>
                              ) : (
                                <span className="rounded bg-slate-900 px-1.5 py-0.2 text-slate-400 border border-slate-800">
                                  Standalone Pod
                                </span>
                              )}

                              <span className="text-slate-500 font-mono">
                                1/1 Ready • CRI Isolated
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================= ACTIVE SERVICES & KUBE-PROXY SECTION ================= */}
      {clusterState.services?.length > 0 && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#081524]/90 p-3.5 shadow-xl backdrop-blur-md space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-xs text-cyan-300">
                <span>🔌</span>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
                  Active Services & Kube-Proxy Packet Routing
                </h4>
                <p className="text-[10px] text-slate-400">
                  Virtual IP load balancing ➔ Dynamic Endpoints on Worker Nodes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTrafficVisualizer(!showTrafficVisualizer)}
                className={`flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded transition-all ${
                  showTrafficVisualizer
                    ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30"
                    : "bg-cyan-950/80 text-cyan-300 border border-cyan-700/50 hover:bg-cyan-900/80"
                }`}
              >
                <span>⚡</span>
                <span>{showTrafficVisualizer ? "Hide Traffic Mesh" : "Simulate Live Traffic"}</span>
              </button>
              <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-700/50">
                iptables Mode Active
              </span>
            </div>
          </div>

          {/* Services List */}
          <div className="grid grid-cols-1 gap-2.5">
            {clusterState.services.map((svc, sIdx) => {
              const endpoints = getEndpointsForService(svc);

              return (
                <div
                  key={svc.name || sIdx}
                  className="rounded-xl border border-cyan-700/40 bg-[#050e1a] p-3 font-mono text-xs space-y-2"
                >
                  {/* Service Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                      <strong className="text-white text-xs">{svc.name}</strong>
                      <span className="rounded bg-cyan-950 px-1.5 py-0.2 text-[9px] font-bold text-cyan-300 border border-cyan-700/50">
                        {svc.type || "ClusterIP"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-slate-400">
                        VIP: <strong className="text-cyan-200">{svc.clusterIP}</strong>
                      </span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">
                        Port: <strong className="text-slate-200">{formatServicePortDisplay(svc.ports)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Kube-Proxy Endpoints Mapping */}
                  <div className="rounded-lg bg-[#02060e] p-2 border border-slate-800/90 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <span>⚡</span>
                        <span>Kube-Proxy Target Endpoints ({endpoints.length} Active)</span>
                      </span>
                      <span className="text-slate-500">Round-Robin DNAT</span>
                    </div>

                    {endpoints.length === 0 ? (
                      <div className="text-[10px] text-amber-400/80 italic py-0.5">
                        No active pod endpoints matching selector. Traffic will be dropped until pods are Ready.
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {endpoints.map((ep, eIdx) => (
                          <div
                            key={eIdx}
                            className="flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[10px] border border-cyan-900/60 text-cyan-300"
                          >
                            <span className="text-emerald-400 font-bold">●</span>
                            <span className="font-bold">{ep.endpoint}</span>
                            <span className="text-[9px] text-slate-400">
                              ({ep.node})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Live Traffic Mesh Simulation */}
          {showTrafficVisualizer && (
            <div className="pt-2">
              <TrafficAnimation
                services={clusterState.services}
                pods={allAssignedPods}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
