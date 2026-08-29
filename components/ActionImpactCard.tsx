"use client";

import React, { useState } from "react";
import { ActionImpact, ClusterState } from "@/engine/cluster-state";

export interface ActionImpactCardProps {
  impact?: ActionImpact;
  recentFlow?: {
    flow: string[];
    description: string;
    timestamp: number;
  } | null;
  lastCommand?: string;
  clusterState?: ClusterState;
  className?: string;
}

interface CausalStep {
  component: string;
  badgeColor: string;
  title: string;
  effect: string;
  subsystem?: string;
}

export default function ActionImpactCard({
  impact,
  recentFlow,
  lastCommand,
  clusterState,
  className = "",
}: ActionImpactCardProps) {
  const [showKernelDetails, setShowKernelDetails] = useState(false);

  const activeImpact = impact || clusterState?.lastActionImpact;

  // Generate detailed causal sequence based on impact OR recentFlow / lastCommand
  const generateCausalSequence = (): {
    headline: string;
    steps: CausalStep[];
    summary: string;
    controlPlaneEvents: string[];
  } => {
    // If activeImpact object is provided directly
    if (activeImpact) {
      const steps: CausalStep[] = activeImpact.dataPlaneEvents.map((evt, idx) => {
        let comp = "Data Plane";
        let color = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
        let sub = "Worker Node";

        if (evt.toLowerCase().includes("kubelet")) {
          comp = "kubelet";
          color = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
          sub = "syncLoop / PodWorker";
        } else if (evt.toLowerCase().includes("containerd") || evt.toLowerCase().includes("cri") || evt.toLowerCase().includes("pulled") || evt.toLowerCase().includes("cgroup")) {
          comp = "containerd CRI";
          color = "bg-teal-500/20 text-teal-300 border-teal-500/40";
          sub = "runc / namespaces & cgroups";
        } else if (evt.toLowerCase().includes("network") || evt.toLowerCase().includes("ip") || evt.toLowerCase().includes("cni") || evt.toLowerCase().includes("bridge")) {
          comp = "CNI (cni0)";
          color = "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
          sub = "veth pair & bridge";
        } else if (evt.toLowerCase().includes("proxy") || evt.toLowerCase().includes("iptables") || evt.toLowerCase().includes("service")) {
          comp = "kube-proxy";
          color = "bg-purple-500/20 text-purple-300 border-purple-500/40";
          sub = "iptables / IPVS NAT";
        }

        return {
          component: comp,
          badgeColor: color,
          title: `Step ${idx + 1}: Physical Execution`,
          effect: evt,
          subsystem: sub,
        };
      });

      return {
        headline: activeImpact.userAction || "Applied Kubernetes Workload Spec",
        summary: activeImpact.summary || "Your declarative intent was translated into active container host sandboxes across the Data Plane.",
        steps: steps.length > 0 ? steps : [
          {
            component: "kubelet",
            badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
            title: "1. Worker Node Sync",
            effect: "kubelet received PodSpec and synchronized local container runtime.",
            subsystem: "Worker Host",
          },
          {
            component: "containerd CRI",
            badgeColor: "bg-teal-500/20 text-teal-300 border-teal-500/40",
            title: "2. Container Isolation",
            effect: "Isolated Linux namespaces (pid, net, ipc) and attached to host cgroups.",
            subsystem: "Host Kernel",
          },
        ],
        controlPlaneEvents: activeImpact.controlPlaneEvents || [],
      };
    }

    if (!recentFlow && !lastCommand) {
      return {
        headline: "Ready for Workload Execution",
        summary: "Type a command in the terminal or apply a YAML manifest to observe real-time Kubernetes Data Plane causal propagation.",
        steps: [
          {
            component: "Terminal / YAML",
            badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/40",
            title: "1. Declarative Intent",
            effect: "Learner inputs kubectl CLI command or applies Kubernetes manifest.",
            subsystem: "User Space",
          },
          {
            component: "Control Plane",
            badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
            title: "2. Master Reconciliation",
            effect: "API Server validates schema, etcd commits transaction, scheduler binds pod to target worker node.",
            subsystem: "Master Node (172.18.0.1)",
          },
          {
            component: "Data Plane",
            badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
            title: "3. Physical Host Execution",
            effect: "Kubelet invokes containerd CRI, isolates Linux namespaces & cgroups, CNI provisions IP on cni0.",
            subsystem: "Worker Node Kernel (172.18.0.2 / 172.18.0.3)",
          },
        ],
        controlPlaneEvents: ["kube-apiserver: Waiting for requests", "etcd: Linearized raft consensus healthy"],
      };
    }

    const desc = recentFlow?.description || "";
    const flow = recentFlow?.flow || [];

    // Pod creation / run
    if (desc.includes("validated Pod") || desc.includes("run") || flow.includes("CRI")) {
      const podName = desc.match(/'([^']+)'/)?.[1] || "frontend-app";
      return {
        headline: `Created & Scheduled Pod: '${podName}'`,
        summary: "Your declarative command triggered a full master-to-worker causal sequence, binding the pod to an isolated Linux container sandbox on the Data Plane.",
        steps: [
          {
            component: "kube-apiserver & etcd",
            badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
            title: "1. Authentication & State Ingestion",
            effect: `API Server authenticated request, verified RBAC, validated PodSpec for '${podName}', and persisted it to etcd key-value store.`,
            subsystem: "etcd /registry/pods/default",
          },
          {
            component: "kube-scheduler",
            badgeColor: "bg-violet-500/20 text-violet-300 border-violet-500/40",
            title: "2. Node Placement Decision",
            effect: "Scheduler filtered eligible nodes, scored worker-node-1 (172.18.0.2) based on memory/CPU availability, and created NodeBinding object.",
            subsystem: "Scheduling Algorithm (Filter & Score)",
          },
          {
            component: "kubelet",
            badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
            title: "3. Worker Node Watch & Sync",
            effect: `kubelet on worker-node-1 detected assigned PodSpec via HTTP/2 watch stream and triggered local Container Runtime Interface (CRI).`,
            subsystem: "syncLoop / PodWorker",
          },
          {
            component: "containerd CRI",
            badgeColor: "bg-teal-500/20 text-teal-300 border-teal-500/40",
            title: "4. Container Sandboxing & Isolation",
            effect: "containerd pulled image, created OCI bundle, initialized cgroups v2 limits, and isolated Linux namespaces (mnt, pid, net, ipc, uts).",
            subsystem: "runc / Linux namespaces & cgroups",
          },
          {
            component: "CNI (cni0 bridge)",
            badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
            title: "5. Virtual Network Interface (veth)",
            effect: "CNI plugin created veth pair, linked one end into pod's network namespace and the other to cni0 bridge, assigning IP 10.244.1.14.",
            subsystem: "Linux Kernel veth & bridge",
          },
        ],
        controlPlaneEvents: [
          `kube-apiserver: Accepted POST /api/v1/namespaces/default/pods/${podName}`,
          `etcd: Revision incremented, raft WAL log synchronized`,
          `kube-scheduler: Evaluated 2 nodes, selected worker-node-1`,
        ],
      };
    }

    // Deletion
    if (desc.includes("deletion") || desc.includes("delete") || desc.includes("cleaned up")) {
      return {
        headline: "Terminated & Reconciled Workload",
        summary: "Graceful termination signal was sent to the container process, followed by resource garbage collection on the Data Plane host.",
        steps: [
          {
            component: "kube-apiserver",
            badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
            title: "1. Marked for Deletion",
            effect: "API server updated object status with deletionGracePeriodSeconds=30 and notified worker node kubelet.",
            subsystem: "etcd metadata.deletionTimestamp",
          },
          {
            component: "kubelet & containerd",
            badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/40",
            title: "2. SIGTERM & Container Teardown",
            effect: "kubelet sent SIGTERM to PID 1 container process, allowed grace period to drain connections, then issued SIGKILL.",
            subsystem: "kill -SIGTERM PID",
          },
          {
            component: "CNI & cgroups",
            badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/40",
            title: "3. Kernel Namespace & IP Release",
            effect: "CNI plugin tore down veth pair, returned IP to IPAM pool, and kernel destroyed the pod cgroup hierarchy.",
            subsystem: "cgroups v2 & IPAM cleanup",
          },
        ],
        controlPlaneEvents: [
          "kube-apiserver: Updated status to Terminating",
          "kube-controller-manager: Observed pod removal event",
        ],
      };
    }

    // Default fallback
    return {
      headline: lastCommand ? `Executed: ${lastCommand}` : "Reconciliation Loop Processed",
      summary: desc || "Cluster state was successfully processed by control plane controllers and worker daemons.",
      steps: [
        {
          component: "Control Plane",
          badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
          title: "1. Master Ingestion",
          effect: desc || "Processed by API Server and stored in cluster key-value database.",
          subsystem: "Control Plane Daemons",
        },
        {
          component: "Data Plane",
          badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          title: "2. Worker Node Enforcement",
          effect: "Data Plane nodes synchronized their local state to match desired configuration.",
          subsystem: "Host Kernel & Runtimes",
        },
      ],
      controlPlaneEvents: ["kube-apiserver: Validated request", "etcd: Committed transaction"],
    };
  };

  const { headline, steps, summary, controlPlaneEvents } = generateCausalSequence();

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-sky-500/30 bg-gradient-to-br from-[#0a182e]/95 via-[#0c162a]/95 to-[#081120]/95 p-4 shadow-xl backdrop-blur-md transition-all duration-300 hover:border-sky-500/50 ${className}`}
    >
      {/* Top Accent Line */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-sky-500/40 via-emerald-400/60 to-indigo-500/40" />

      {/* Header Section */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-sky-500/20">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 border border-sky-400/30 text-sm text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.3)]">
            <span>⚡</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-sky-400">
                What did I just do?
              </span>
              <span className="rounded-full bg-emerald-950/80 px-2 py-0.2 text-[9px] font-mono font-semibold text-emerald-300 border border-emerald-700/50">
                Data Plane Impact
              </span>
            </div>
            <h3 className="text-sm font-bold text-white tracking-tight mt-0.5">
              {headline}
            </h3>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
            Causal Sequence
          </span>
        </div>
      </div>

      {/* Summary Narrative */}
      <p className="mt-2.5 text-xs text-slate-300 leading-relaxed">
        {summary}
      </p>

      {/* Causal Sequence Step Badges */}
      <div className="mt-3.5 space-y-2">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2.5 rounded-lg border border-slate-800/80 bg-[#060c18]/80 p-2.5 transition-all duration-200 hover:border-slate-700 hover:bg-[#0a1324]"
          >
            {/* Step Number / Status Icon */}
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-mono font-bold text-slate-300 border border-slate-700 mt-0.5">
              {idx + 1}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="text-xs font-bold text-slate-200">
                  {step.title}
                </span>
                <span
                  className={`rounded px-1.5 py-0.2 text-[9px] font-mono font-bold border ${step.badgeColor}`}
                >
                  [{step.component}]
                </span>
                {step.subsystem && (
                  <span className="text-[9px] font-mono text-slate-500 hidden sm:inline">
                    • {step.subsystem}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
                {step.effect}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Control Plane Ambient Orchestration */}
      {controlPlaneEvents && controlPlaneEvents.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
          <div className="text-[10px] font-semibold text-indigo-400 flex items-center gap-1 mb-1">
            <span>🧠</span>
            <span>Control Plane Master Orchestration:</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 space-y-0.5 pl-1">
            {controlPlaneEvents.map((cp, idx) => (
              <div key={idx} className="truncate">
                • {cp}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Low-Level Kernel & Linux Subsystem Drawer */}
      <div className="mt-3 pt-2 border-t border-slate-800/80">
        <button
          type="button"
          onClick={() => setShowKernelDetails(!showKernelDetails)}
          className="flex items-center justify-between w-full text-[11px] font-mono text-slate-400 hover:text-sky-300 transition-colors py-1 px-1 rounded"
        >
          <span className="flex items-center gap-1.5">
            <span>🐧</span>
            <span className="underline decoration-dotted underline-offset-4">
              {showKernelDetails
                ? "Hide Linux Kernel Subsystem Mechanics"
                : "View Under-The-Hood: Linux Kernel Namespaces, cgroups & CNI"}
            </span>
          </span>
          <span className="text-xs">{showKernelDetails ? "▲" : "▼"}</span>
        </button>

        {showKernelDetails && (
          <div className="mt-2 rounded-lg bg-[#040812] border border-sky-900/40 p-3 text-[11px] font-mono text-slate-300 space-y-2.5 animate-fadeIn">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
              <div className="rounded bg-slate-900/80 p-2 border border-slate-800">
                <span className="text-emerald-400 font-bold">Linux Namespaces:</span>
                <p className="text-slate-400 mt-0.5">
                  <code className="text-slate-200">net, pid, mnt, ipc, uts</code> isolate process tree, routing table, and hostname per pod.
                </p>
              </div>
              <div className="rounded bg-slate-900/80 p-2 border border-slate-800">
                <span className="text-cyan-400 font-bold">cgroups v2:</span>
                <p className="text-slate-400 mt-0.5">
                  Limits CPU shares (<code className="text-slate-200">cpu.max</code>) and memory ceiling (<code className="text-slate-200">memory.max</code>) on host kernel.
                </p>
              </div>
              <div className="rounded bg-slate-900/80 p-2 border border-slate-800">
                <span className="text-indigo-400 font-bold">Virtual Ethernet (veth):</span>
                <p className="text-slate-400 mt-0.5">
                  Point-to-point tunnel bridging container <code className="text-slate-200">eth0</code> to host bridge <code className="text-slate-200">cni0</code>.
                </p>
              </div>
              <div className="rounded bg-slate-900/80 p-2 border border-slate-800">
                <span className="text-purple-400 font-bold">kube-proxy iptables:</span>
                <p className="text-slate-400 mt-0.5">
                  DNAT rules translate Service ClusterIPs into direct container IPs with randomized load distribution.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
