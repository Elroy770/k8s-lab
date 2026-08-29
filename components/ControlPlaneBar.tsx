"use client";

import React, { useState, useEffect } from "react";
import { ClusterState } from "@/engine/cluster-state";

export interface ControlPlaneBarProps {
  activeComponents?: string[];
  isReconciling?: boolean;
  recentFlow?: {
    flow: string[];
    description: string;
    timestamp: number;
  } | null;
  clusterState?: ClusterState;
  className?: string;
}

interface ComponentMeta {
  id: string;
  name: string;
  shortName: string;
  role: string;
  port: string;
  icon: string;
  aliases: string[];
  color: string;
  activeColor: string;
  glowColor: string;
}

const CONTROL_COMPONENTS: ComponentMeta[] = [
  {
    id: "kube-apiserver",
    name: "kube-apiserver",
    shortName: "API-Server",
    role: "REST API Gateway & Admission Controller",
    port: "6443",
    icon: "⚡",
    aliases: ["kube-apiserver", "API Server", "Terminal", "apiserver"],
    color: "border-indigo-500/30 text-indigo-300 bg-indigo-950/40",
    activeColor: "border-indigo-400 bg-indigo-900/70 text-indigo-100 shadow-[0_0_14px_rgba(99,102,241,0.6)] ring-1 ring-indigo-400/70",
    glowColor: "bg-indigo-400",
  },
  {
    id: "etcd",
    name: "etcd",
    shortName: "etcd v3.5",
    role: "Distributed Consistent Key-Value Store",
    port: "2379",
    icon: "🗄️",
    aliases: ["etcd"],
    color: "border-cyan-500/30 text-cyan-300 bg-cyan-950/40",
    activeColor: "border-cyan-400 bg-cyan-900/70 text-cyan-100 shadow-[0_0_14px_rgba(6,182,212,0.6)] ring-1 ring-cyan-400/70",
    glowColor: "bg-cyan-400",
  },
  {
    id: "kube-scheduler",
    name: "kube-scheduler",
    shortName: "Scheduler",
    role: "Node Scoring & Pod Placement Engine",
    port: "10259",
    icon: "🎯",
    aliases: ["kube-scheduler", "Scheduler", "default-scheduler"],
    color: "border-violet-500/30 text-violet-300 bg-violet-950/40",
    activeColor: "border-violet-400 bg-violet-900/70 text-violet-100 shadow-[0_0_14px_rgba(139,92,246,0.6)] ring-1 ring-violet-400/70",
    glowColor: "bg-violet-400",
  },
  {
    id: "kube-controller-manager",
    name: "kube-controller-manager",
    shortName: "Controller-Mgr",
    role: "Reconciliation & Workload State Engine",
    port: "10257",
    icon: "🔄",
    aliases: ["kube-controller-manager", "controller-mgr", "Controller", "Deployment Controller", "ReplicaSet Controller", "controller-manager"],
    color: "border-purple-500/30 text-purple-300 bg-purple-950/40",
    activeColor: "border-purple-400 bg-purple-900/70 text-purple-100 shadow-[0_0_14px_rgba(168,85,247,0.6)] ring-1 ring-purple-400/70",
    glowColor: "bg-purple-400",
  },
];

export default function ControlPlaneBar({
  activeComponents = [],
  isReconciling = false,
  recentFlow,
  clusterState,
  className = "",
}: ControlPlaneBarProps) {
  const [selectedComp, setSelectedComp] = useState<ComponentMeta | null>(null);
  const [pulseActive, setPulseActive] = useState(false);

  // Manage transient pulse activity
  useEffect(() => {
    if (recentFlow || isReconciling || activeComponents.length > 0) {
      setPulseActive(true);
      const timer = setTimeout(() => {
        setPulseActive(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [recentFlow, isReconciling, activeComponents]);

  const isComponentActive = (comp: ComponentMeta): boolean => {
    if (isReconciling) return true;

    // Check direct activeComponents array
    if (activeComponents.length > 0) {
      const match = activeComponents.some((item) =>
        comp.aliases.some(
          (alias) =>
            item.toLowerCase().includes(alias.toLowerCase()) ||
            alias.toLowerCase().includes(item.toLowerCase())
        )
      );
      if (match) return true;
    }

    // Check recentFlow
    if (pulseActive && recentFlow?.flow) {
      return recentFlow.flow.some((item) =>
        comp.aliases.some(
          (alias) =>
            item.toLowerCase().includes(alias.toLowerCase()) ||
            alias.toLowerCase().includes(item.toLowerCase())
        )
      );
    }

    return false;
  };

  const activeCount = CONTROL_COMPONENTS.filter((c) => isComponentActive(c)).length;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-r from-[#070e1e]/90 via-[#0b162f]/85 to-[#070e1e]/90 p-2.5 backdrop-blur-md transition-all duration-300 shadow-md ${className}`}
    >
      {/* Ambient background soft light bar */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

      {/* Main Bar Flex Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Control Plane Ambient Label & Indicator */}
        <div className="flex items-center space-x-2.5 min-w-fit">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-900/40 border border-indigo-500/30 text-xs text-indigo-300">
            <span>🧠</span>
            <span
              className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                activeCount > 0
                  ? "bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.9)] animate-ping"
                  : "bg-indigo-500/60"
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-indigo-300/90">
                Control Plane
              </span>
              <span className="rounded bg-indigo-950/60 px-1.5 py-0.2 text-[9px] font-mono text-indigo-400 border border-indigo-800/40">
                ambient
              </span>
            </div>
            <p className="text-[9px] text-slate-400 font-mono hidden sm:block leading-none mt-0.5">
              Master Plane • 172.18.0.1
            </p>
          </div>
        </div>

        {/* Middle: Micro-Badges for the 4 Control Plane Daemons */}
        <div className="flex items-center flex-wrap gap-1.5 flex-1 justify-center sm:justify-start md:justify-center">
          {CONTROL_COMPONENTS.map((comp) => {
            const active = isComponentActive(comp);
            const isSelected = selectedComp?.id === comp.id;

            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => setSelectedComp(isSelected ? null : comp)}
                title={`${comp.name} (${comp.role}) — Click for info`}
                className={`group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-mono font-medium transition-all duration-300 border ${
                  active
                    ? comp.activeColor
                    : `${comp.color} hover:border-indigo-400/50 hover:bg-indigo-950/60`
                } ${isSelected ? "ring-1 ring-indigo-400" : ""}`}
              >
                {/* Active Soft Pulse Halo */}
                {active && (
                  <span
                    className={`absolute -inset-0.5 rounded-lg opacity-40 blur-sm animate-pulse ${comp.glowColor}`}
                  />
                )}

                {/* Status Dot */}
                <span
                  className={`relative h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                    active
                      ? `${comp.glowColor} shadow-[0_0_6px_currentColor] animate-ping`
                      : "bg-slate-500 group-hover:bg-indigo-300"
                  }`}
                />

                <span className="relative select-none">{comp.icon}</span>
                <span className="relative font-bold tracking-tight">{comp.shortName}</span>
                <span className="relative text-[8px] opacity-60 hidden xl:inline">
                  :{comp.port}
                </span>

                {active && (
                  <span className="relative ml-0.5 flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Reconciliation / Sync Status */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 min-w-fit">
          {activeCount > 0 || isReconciling ? (
            <div className="flex items-center gap-1.5 text-indigo-300 font-semibold bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-700/50 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
              <span>Reconciling State...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-400 bg-slate-900/50 px-2 py-0.5 rounded-md border border-slate-800/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
              <span>State Synchronized</span>
            </div>
          )}

          {clusterState && (
            <div className="hidden lg:flex items-center gap-1 text-[9px] text-slate-400 border-l border-slate-800 pl-2">
              <span>Objs:</span>
              <span className="text-slate-200 font-bold">
                {(clusterState.deployments?.length || 0) +
                  (clusterState.replicaSets?.length || 0) +
                  (clusterState.daemonSets?.length || 0) +
                  (clusterState.services?.length || 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Component Inspector Card (on micro-badge click) */}
      {selectedComp && (
        <div className="mt-2.5 rounded-lg border border-indigo-500/30 bg-[#060c18] p-2.5 text-xs animate-fadeIn">
          <div className="flex items-center justify-between border-b border-indigo-900/50 pb-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm">{selectedComp.icon}</span>
              <span className="font-mono font-bold text-indigo-200 text-xs">
                {selectedComp.name}
              </span>
              <span className="rounded bg-indigo-900/60 px-1.5 py-0.2 text-[9px] font-mono text-indigo-300 border border-indigo-700/40">
                Port {selectedComp.port}
              </span>
              <span className="text-[9px] font-mono text-emerald-400">
                ● Healthy (Leader)
              </span>
            </div>
            <button
              onClick={() => setSelectedComp(null)}
              className="text-[10px] text-slate-400 hover:text-slate-200 font-mono px-1.5 py-0.5 rounded hover:bg-slate-800"
            >
              ✕ Close
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div>
              <span className="text-slate-500 font-mono text-[10px]">Role: </span>
              {selectedComp.role}
            </div>
            <div className="font-mono text-[10px] text-indigo-300/90 flex items-center gap-1">
              <span>Architecture:</span>
              <span className="text-slate-300">
                Runs on Master node (172.18.0.1) • Communicates via TLS mTLS
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
