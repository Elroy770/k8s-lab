"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Lesson,
  ClusterState,
  Pod,
  ReplicaSet,
  Deployment,
  DaemonSet,
  StatefulSet,
  Job,
  CronJob,
  Service,
  ServicePort,
  Namespace,
  ConfigMapResource,
  SecretResource,
} from "@/engine/cluster-state";
import { executeCommand, ExecutionResult } from "@/engine/simulator";

interface LabProps {
  lessons: Lesson[];
}

interface TerminalItem {
  id: string;
  type: "cmd" | "out" | "success" | "system" | "error";
  text: string;
}

export default function Lab({ lessons }: LabProps) {
  const [activeLessonIdx, setActiveLessonIdx] = useState(0);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [terminalOutput, setTerminalOutput] = useState<TerminalItem[]>([
    {
      id: "init-1",
      type: "system",
      text: "☸ Kubernetes Story Lab v2.0 — Interactive Learning Cluster",
    },
    {
      id: "init-2",
      type: "system",
      text: "Type 'help' for available kubectl commands, or follow the guided missions on the left.\n",
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [currentCommand, setCurrentCommand] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [showBehindTheScenes, setShowBehindTheScenes] = useState(false);
  const [recentFlow, setRecentFlow] = useState<{
    flow: string[];
    description: string;
    timestamp: number;
  } | null>(null);
  const [stepCompleted, setStepCompleted] = useState(false);

  const [clusterState, setClusterState] = useState<ClusterState>({
    pods: [],
    replicaSets: [],
    deployments: [],
    daemonSets: [],
    statefulSets: [],
    jobs: [],
    cronJobs: [],
    services: [],
    namespaces: [],
    configMaps: [],
    secrets: [],
  });

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentLesson = lessons[activeLessonIdx] || lessons[0];
  const currentStep = currentLesson?.steps?.[activeStepIdx];

  // Initialize cluster state when lesson changes
  useEffect(() => {
    if (currentLesson) {
      if (currentLesson.initialState) {
        setClusterState({
          pods: currentLesson.initialState.pods || [],
          replicaSets: currentLesson.initialState.replicaSets || [],
          deployments: currentLesson.initialState.deployments || [],
          daemonSets: currentLesson.initialState.daemonSets || [],
          statefulSets: currentLesson.initialState.statefulSets || [],
          jobs: currentLesson.initialState.jobs || [],
          cronJobs: currentLesson.initialState.cronJobs || [],
          services: currentLesson.initialState.services || [],
          namespaces: currentLesson.initialState.namespaces || [],
          configMaps: currentLesson.initialState.configMaps || [],
          secrets: currentLesson.initialState.secrets || [],
        });
      } else {
        setClusterState({
          pods: [],
          replicaSets: [],
          deployments: [],
          daemonSets: [],
          statefulSets: [],
          jobs: [],
          cronJobs: [],
          services: [],
          namespaces: [],
          configMaps: [],
          secrets: [],
        });
      }
      setActiveStepIdx(0);
      setShowHint(false);
      setShowBehindTheScenes(false);
      setStepCompleted(false);
      setRecentFlow(null);

      setTerminalOutput((prev) => [
        ...prev,
        {
          id: `lesson-${Date.now()}`,
          type: "system",
          text: `\n======================================================\n📚 Lesson ${
            activeLessonIdx + 1
          }: ${currentLesson.title}\n======================================================\n`,
        },
      ]);
    }
  }, [activeLessonIdx, currentLesson]);

  // Reset step completed flag when step index changes
  useEffect(() => {
    setStepCompleted(false);
    setShowHint(false);
  }, [activeStepIdx]);

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalOutput]);

  const handleCommandRun = (cmdString: string) => {
    const cmd = cmdString.trim();
    if (!cmd) return;

    if (cmd === "clear") {
      setTerminalOutput([]);
      setCurrentCommand("");
      return;
    }

    const result: ExecutionResult = executeCommand(cmd, clusterState, currentStep);

    const newItems: TerminalItem[] = [
      {
        id: `cmd-${Date.now()}`,
        type: "cmd",
        text: `learner@k8s:~$ ${cmd}`,
      },
    ];

    if (result.output) {
      newItems.push({
        id: `out-${Date.now()}`,
        type: result.isCorrect
          ? "success"
          : result.output.toLowerCase().includes("error")
          ? "error"
          : "out",
        text: result.output,
      });
    }

    setClusterState(result.newState);
    setTerminalOutput((prev) => [...prev, ...newItems]);
    setCommandHistory((prev) => [...prev, cmd]);
    setHistoryIndex(null);
    setCurrentCommand("");

    if (result.componentFlow && result.actionDescription) {
      setRecentFlow({
        flow: result.componentFlow,
        description: result.actionDescription,
        timestamp: Date.now(),
      });
    }

    if (result.isCorrect) {
      setStepCompleted(true);
      if (activeStepIdx < (currentLesson?.steps?.length || 1) - 1) {
        setTimeout(() => {
          setActiveStepIdx((s) => s + 1);
        }, 1200);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommandRun(currentCommand);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIdx =
        historyIndex === null
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setCurrentCommand(commandHistory[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === null) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= commandHistory.length) {
        setHistoryIndex(null);
        setCurrentCommand("");
      } else {
        setHistoryIndex(nextIdx);
        setCurrentCommand(commandHistory[nextIdx]);
      }
    }
  };

  const handleNextStep = () => {
    if (activeStepIdx < (currentLesson?.steps?.length || 1) - 1) {
      setActiveStepIdx(activeStepIdx + 1);
    } else if (activeLessonIdx < lessons.length - 1) {
      setActiveLessonIdx(activeLessonIdx + 1);
    }
  };

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

  if (!currentLesson) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070b14] text-white">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-spin">☸</div>
          <p className="text-slate-400">Loading Kubernetes Story Lab...</p>
        </div>
      </div>
    );
  }

  const totalSteps = currentLesson.steps?.length || 1;
  const progressPct = Math.round(((activeStepIdx + (stepCompleted ? 1 : 0)) / totalSteps) * 100);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#070b14] text-slate-100 font-sans select-none overflow-hidden">
      {/* Top Header & Lesson Navigator */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1b253b] bg-[#0c1220] px-6 z-20">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-md shadow-blue-500/20">
            ☸
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wide text-white">
                Kubernetes Story Lab
              </h1>
              <span className="rounded bg-blue-900/60 px-2 py-0.5 text-[10px] font-mono font-semibold text-blue-300 border border-blue-700/50">
                CKA Interactive
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Interactive Lab & Cause-and-Effect Architecture Simulation
            </p>
          </div>
        </div>

        {/* Lesson Selector Dropdown & Progress */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 bg-[#141c2e] px-2 py-1 rounded-lg border border-[#22304d]">
            <button
              disabled={activeLessonIdx === 0}
              onClick={() => setActiveLessonIdx((l) => l - 1)}
              className="px-2 py-1 text-xs font-semibold rounded bg-[#1c2740] text-slate-300 hover:bg-[#28385c] disabled:opacity-40 transition-colors"
              title="Previous Lesson"
            >
              ← Prev
            </button>

            <select
              value={activeLessonIdx}
              onChange={(e) => setActiveLessonIdx(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-white px-2 py-1 outline-none cursor-pointer max-w-[280px] truncate"
            >
              {lessons.map((l, idx) => (
                <option key={l.id || idx} value={idx} className="bg-[#0f172a] text-white">
                  {idx + 1}. {l.title.replace(/^\d+\.\s*/, "")}
                </option>
              ))}
            </select>

            <button
              disabled={activeLessonIdx === lessons.length - 1}
              onClick={() => setActiveLessonIdx((l) => l + 1)}
              className="px-2 py-1 text-xs font-semibold rounded bg-[#1c2740] text-slate-300 hover:bg-[#28385c] disabled:opacity-40 transition-colors"
              title="Next Lesson"
            >
              Next →
            </button>
          </div>

          <div className="hidden md:flex flex-col items-end">
            <span className="text-[11px] text-slate-400 font-mono">
              Lesson {activeLessonIdx + 1} / {lessons.length}
            </span>
            <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{
                  width: `${((activeLessonIdx + 1) / lessons.length) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Split Layout: Left (Story + Terminal) vs Right (Live Cluster Visualizer) */}
      <div className="flex flex-1 overflow-hidden">
        {/* ================= LEFT SIDE: Story, Objectives & Terminal ================= */}
        <div className="flex w-1/2 flex-col border-r border-[#1b253b] bg-[#090e1a] overflow-hidden">
          {/* Upper Section: Lesson Story, Explanation & Step Card */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 thin-scroll">
            {/* Lesson Title & Intro Banner */}
            <div className="rounded-xl border border-[#202d47] bg-[#0e1628] p-5 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                  Lesson {activeLessonIdx + 1} of {lessons.length}
                </span>
                <span className="text-[11px] font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
                  Progress: Step {activeStepIdx + 1} of {totalSteps} ({progressPct}%)
                </span>
              </div>
              <h2 className="text-xl font-extrabold text-white tracking-tight">
                {currentLesson.title}
              </h2>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                {currentLesson.intro}
              </p>
            </div>

            {/* Current Step Card */}
            {currentStep && (
              <div
                className={`rounded-xl border p-5 shadow-xl transition-all ${
                  stepCompleted
                    ? "border-emerald-500/60 bg-emerald-950/20 shadow-emerald-950/30"
                    : "border-blue-500/50 bg-[#121c32] shadow-blue-950/20"
                }`}
              >
                {/* Step Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        currentStep.type === "challenge"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : currentStep.type === "observation"
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                          : currentStep.type === "explanation"
                          ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      }`}
                    >
                      {currentStep.type}
                    </span>
                    <h3 className="text-sm font-bold text-white">
                      {currentStep.title || `Step ${activeStepIdx + 1}`}
                    </h3>
                  </div>

                  {stepCompleted ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 animate-pulse">
                      ✓ Mission Complete!
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-slate-400">
                      Step {activeStepIdx + 1} / {totalSteps}
                    </span>
                  )}
                </div>

                {/* Step Body (Text / Description / Prompt) */}
                <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line mb-4 font-sans">
                  {currentStep.description || currentStep.text || currentStep.prompt}
                </div>

                {/* Actionable Prompt Banner for Challenges */}
                {currentStep.type === "challenge" && currentStep.prompt && (
                  <div className="mb-4 rounded-lg bg-black/40 p-3.5 border border-amber-500/30 flex items-start gap-2.5">
                    <span className="text-amber-400 text-base">🎯</span>
                    <div className="flex-1">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                        Your Action Required:
                      </div>
                      <p className="text-xs font-medium text-slate-100 mt-0.5">
                        {currentStep.prompt}
                      </p>
                    </div>
                  </div>
                )}

                {/* Hint Bar & One-Click Run */}
                {currentStep.hint && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setShowHint(!showHint)}
                        className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                      >
                        💡 {showHint ? "Hide Hint" : "Need a Hint?"}
                      </button>
                    </div>

                    {showHint && (
                      <div className="mt-2 rounded-lg bg-black/60 p-3 border border-amber-500/30 flex items-center justify-between gap-3">
                        <code className="text-xs font-mono text-amber-200 break-all select-all">
                          {currentStep.hint}
                        </code>
                        <button
                          onClick={() => {
                            setCurrentCommand(currentStep.hint || "");
                            inputRef.current?.focus();
                          }}
                          className="shrink-0 rounded bg-amber-500/20 px-2.5 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-all"
                          title="Paste command into terminal"
                        >
                          📋 Paste
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Behind the Scenes Collapsible Drawer */}
                {currentStep.behindTheScenes && (
                  <div className="rounded-lg border border-purple-900/50 bg-[#16122b] overflow-hidden mb-4">
                    <button
                      onClick={() => setShowBehindTheScenes(!showBehindTheScenes)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-purple-950/40 hover:bg-purple-950/70 text-xs font-bold text-purple-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        🔧 Behind the Scenes: Component Architecture
                      </span>
                      <span>{showBehindTheScenes ? "▲" : "▼"}</span>
                    </button>

                    {showBehindTheScenes && (
                      <div className="p-4 text-xs text-purple-200 border-t border-purple-900/50 space-y-3">
                        <p className="whitespace-pre-line leading-relaxed font-sans">
                          {currentStep.behindTheScenes}
                        </p>
                        <div className="rounded bg-black/60 p-2.5 text-[11px] font-mono text-purple-300 border border-purple-900/40 text-center">
                          kubectl ➔ API Server ➔ etcd ➔ Scheduler ➔ kubelet ➔ CRI
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Continue Button for Non-Challenge Steps or Completed Steps */}
                {(currentStep.type !== "challenge" || stepCompleted) && (
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleNextStep}
                      className="rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-1.5"
                    >
                      {activeStepIdx === totalSteps - 1
                        ? "Finish & Next Lesson →"
                        : "Continue to Next Step →"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lower Section: Integrated Interactive Terminal */}
          <div
            className="flex h-64 min-h-[16rem] flex-col border-t border-[#1b253b] bg-[#05080f] font-mono text-xs cursor-text relative select-text"
            onClick={() => inputRef.current?.focus()}
          >
            {/* Terminal Title Bar */}
            <div className="flex h-8 items-center justify-between bg-[#0e1526] px-4 border-b border-[#1b253b] select-none">
              <div className="flex items-center space-x-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/80"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></span>
                <span className="ml-2 text-[11px] font-semibold text-slate-300">
                  terminal — simulated kubectl
                </span>
              </div>
              <div className="flex items-center space-x-3 text-[11px]">
                <span className="text-slate-500">History: ↑ / ↓</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTerminalOutput([]);
                    setCurrentCommand("");
                  }}
                  className="rounded bg-[#1a243a] px-2 py-0.5 text-slate-400 hover:text-white transition-colors"
                  title="Clear Terminal Output"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Terminal Output Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5 thin-scroll">
              {terminalOutput.map((item) => (
                <div
                  key={item.id}
                  className={`whitespace-pre-wrap leading-relaxed ${
                    item.type === "cmd"
                      ? "text-sky-300 font-bold"
                      : item.type === "success"
                      ? "text-emerald-400 font-semibold"
                      : item.type === "error"
                      ? "text-rose-400 font-semibold"
                      : item.type === "system"
                      ? "text-amber-400 font-semibold"
                      : "text-slate-300"
                  }`}
                >
                  {item.text}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            {/* Terminal Input Prompt */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCommandRun(currentCommand);
              }}
              className="flex items-center border-t border-[#1b253b] bg-[#090f1d] px-4 py-2"
            >
              <span className="text-emerald-400 font-bold mr-2 select-none">
                learner@k8s:~$
              </span>
              <input
                ref={inputRef}
                type="text"
                value={currentCommand}
                onChange={(e) => setCurrentCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a kubectl command (e.g. kubectl get pods)..."
                autoFocus
                autoComplete="off"
                spellCheck="false"
                className="flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-600 font-mono text-xs"
              />
            </form>
          </div>
        </div>

        {/* ================= RIGHT SIDE: Kubernetes Cluster Simulation ================= */}
        <div className="flex w-1/2 flex-col bg-[#070b14] overflow-y-auto p-6 space-y-6 thin-scroll">
          {/* Cluster Header & Component Flow Banner */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse" />
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-200">
                  Live Kubernetes Cluster
                </h2>
              </div>
              <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400">
                <span className="rounded bg-slate-800/80 px-2 py-0.5 border border-slate-700/60">
                  Namespace: default
                </span>
                <span className="rounded bg-slate-800/80 px-2 py-0.5 border border-slate-700/60">
                  Pods: {clusterState.pods.length}
                </span>
              </div>
            </div>

            {/* Live Component Activity Breadcrumb */}
            {recentFlow && (
              <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-3.5 shadow-lg transition-all animate-fadeIn">
                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300 mb-1.5 flex items-center gap-1.5">
                  <span className="animate-spin text-xs">☸</span> Active Component Flow:
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs mb-2">
                  {recentFlow.flow.map((comp, i) => (
                    <React.Fragment key={i}>
                      <span className="rounded bg-blue-900/60 px-2 py-0.5 text-blue-200 border border-blue-700/60 font-semibold text-[11px]">
                        {comp}
                      </span>
                      {i < recentFlow.flow.length - 1 && (
                        <span className="text-blue-400 font-bold">➔</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  {recentFlow.description}
                </p>
              </div>
            )}
          </div>

          {/* ================= 1. CONTROL PLANE (MASTER) ================= */}
          <div className="rounded-xl border border-indigo-500/40 bg-gradient-to-b from-indigo-950/20 to-[#0c1224] p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-indigo-500/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base text-indigo-400">🧠</span>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-200">
                    Control Plane (Master Plane)
                  </h3>
                  <p className="text-[10px] text-indigo-400/80">
                    Global State, Scheduling, & Workload Controllers
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-900/40 px-2 py-0.5 rounded border border-indigo-700/50">
                Active
              </span>
            </div>

            {/* Core Control Plane Components Grid */}
            <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono">
              <div className="rounded bg-indigo-900/30 p-2 border border-indigo-800/40">
                <div className="font-bold text-indigo-300">kube-apiserver</div>
                <div className="text-[9px] text-slate-400 mt-0.5">REST API Gateway</div>
              </div>
              <div className="rounded bg-indigo-900/30 p-2 border border-indigo-800/40">
                <div className="font-bold text-indigo-300">etcd</div>
                <div className="text-[9px] text-slate-400 mt-0.5">Key-Value Store</div>
              </div>
              <div className="rounded bg-indigo-900/30 p-2 border border-indigo-800/40">
                <div className="font-bold text-indigo-300">kube-scheduler</div>
                <div className="text-[9px] text-slate-400 mt-0.5">Node Placement</div>
              </div>
              <div className="rounded bg-indigo-900/30 p-2 border border-indigo-800/40">
                <div className="font-bold text-indigo-300">controller-mgr</div>
                <div className="text-[9px] text-slate-400 mt-0.5">Reconciliation</div>
              </div>
            </div>

            {/* Control Plane Resources: Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, ConfigMaps, Secrets */}
            <div className="space-y-3 pt-2">
              {/* Deployments */}
              {clusterState.deployments.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-blue-400 flex items-center gap-1.5">
                    <span>📦</span> Deployments ({clusterState.deployments.length})
                  </div>
                  <div className="grid gap-2">
                    {clusterState.deployments.map((d, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-blue-950/40 border border-blue-800/60 p-3 flex justify-between items-center shadow-md"
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-blue-200">
                            {d.name}
                          </div>
                          <div className="text-[10px] text-blue-400 font-mono mt-0.5">
                            Image: {d.image} • Revision: {d.revision || 1}
                          </div>
                        </div>
                        <div className="text-right bg-blue-900/50 px-2.5 py-1 rounded border border-blue-700/50">
                          <span className="text-[11px] text-blue-200 font-mono font-bold">
                            {d.available || d.upToDate || 0} / {d.replicas} Replicas
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ReplicaSets */}
              {clusterState.replicaSets.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-purple-400 flex items-center gap-1.5">
                    <span>🔄</span> ReplicaSets ({clusterState.replicaSets.length})
                  </div>
                  <div className="grid gap-2">
                    {clusterState.replicaSets.map((rs, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border p-3 flex justify-between items-center transition-all ${
                          rs.desiredReplicas === 0
                            ? "bg-slate-900/40 border-slate-800 opacity-40"
                            : "bg-purple-950/40 border-purple-800/60 shadow-md"
                        }`}
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-purple-200">
                            {rs.name}
                          </div>
                          <div className="text-[10px] text-purple-400 font-mono mt-0.5">
                            Image: {rs.image} {rs.ownerRef ? `• Owner: ${rs.ownerRef.name}` : ""}
                          </div>
                        </div>
                        <div className="bg-purple-900/50 px-2.5 py-1 rounded border border-purple-700/50 font-mono text-[11px] text-purple-200 font-bold">
                          {rs.readyReplicas || rs.currentReplicas || 0} / {rs.desiredReplicas} Pods
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* StatefulSets */}
              {clusterState.statefulSets.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-indigo-400 flex items-center gap-1.5">
                    <span>💾</span> StatefulSets ({clusterState.statefulSets.length})
                  </div>
                  <div className="grid gap-2">
                    {clusterState.statefulSets.map((ss, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-indigo-950/40 border border-indigo-800/60 p-3 flex justify-between items-center shadow-md"
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-indigo-200">
                            {ss.name}
                          </div>
                          <div className="text-[10px] text-indigo-400 font-mono mt-0.5">
                            Image: {ss.image} • Service: {ss.serviceName || "headless"}
                          </div>
                        </div>
                        <div className="bg-indigo-900/50 px-2.5 py-1 rounded border border-indigo-700/50 font-mono text-[11px] text-indigo-200 font-bold">
                          {ss.readyReplicas || 0} / {ss.replicas} Replicas
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DaemonSets */}
              {clusterState.daemonSets.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                    <span>👻</span> DaemonSets ({clusterState.daemonSets.length})
                  </div>
                  <div className="grid gap-2">
                    {clusterState.daemonSets.map((ds, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-amber-950/40 border border-amber-800/60 p-3 flex justify-between items-center shadow-md"
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-amber-200">
                            {ds.name}
                          </div>
                          <div className="text-[10px] text-amber-400 font-mono mt-0.5">
                            Image: {ds.image} • 1 pod per scheduled node
                          </div>
                        </div>
                        <div className="bg-amber-900/50 px-2.5 py-1 rounded border border-amber-700/50 font-mono text-[11px] text-amber-200 font-bold">
                          {ds.readyPods || ds.currentPods || 0} / {ds.desiredNodes} Nodes
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Jobs */}
              {clusterState.jobs.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-teal-400 flex items-center gap-1.5">
                    <span>🎯</span> Jobs ({clusterState.jobs.length})
                  </div>
                  <div className="grid gap-2">
                    {clusterState.jobs.map((j, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-teal-950/40 border border-teal-800/60 p-3 flex justify-between items-center shadow-md"
                      >
                        <div>
                          <div className="font-mono text-xs font-bold text-teal-200">
                            {j.name}
                          </div>
                          <div className="text-[10px] text-teal-400 font-mono mt-0.5">
                            Image: {j.image} • Run to Completion
                          </div>
                        </div>
                        <div className="bg-teal-900/50 px-2.5 py-1 rounded border border-teal-700/50 font-mono text-[11px] text-teal-200 font-bold">
                          {j.succeeded || 0} / {j.completions} Succeeded
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ConfigMaps & Secrets Row */}
              {(clusterState.configMaps.length > 0 || clusterState.secrets.length > 0) && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {/* ConfigMaps */}
                  {clusterState.configMaps.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                        <span>📄</span> ConfigMaps
                      </div>
                      {clusterState.configMaps.map((cm, i) => (
                        <div
                          key={i}
                          className="rounded bg-emerald-950/30 border border-emerald-800/50 p-2 text-[11px] font-mono text-emerald-200"
                        >
                          <div className="font-bold truncate">{cm.name}</div>
                          <div className="text-[9px] text-emerald-400">
                            {Object.keys(cm.data || {}).length} keys stored
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Secrets */}
                  {clusterState.secrets.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-rose-400 flex items-center gap-1">
                        <span>🔐</span> Secrets
                      </div>
                      {clusterState.secrets.map((sec, i) => (
                        <div
                          key={i}
                          className="rounded bg-rose-900/30 border border-rose-800/50 p-2 text-[11px] font-mono text-rose-200"
                        >
                          <div className="font-bold truncate">{sec.name}</div>
                          <div className="text-[9px] text-rose-400">
                            {sec.type} • {Object.keys(sec.data || {}).length || sec.dataKeys?.length || 0} keys
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ================= 2. DATA PLANE (WORKER NODES) ================= */}
          <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/20 to-[#0c1224] p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-base text-emerald-400">🖥️</span>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-200">
                    Data Plane (Worker Nodes)
                  </h3>
                  <p className="text-[10px] text-emerald-400/80">
                    Host execution environments for application containers
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-900/40 px-2 py-0.5 rounded border border-emerald-700/50">
                worker-node-1 (Ready)
              </span>
            </div>

            {/* Node Daemon Agents */}
            <div className="grid grid-cols-2 gap-2 text-center text-[10px] font-mono">
              <div className="rounded bg-emerald-900/30 p-2 border border-emerald-800/40">
                <div className="font-bold text-emerald-300">kubelet</div>
                <div className="text-[9px] text-slate-400 mt-0.5">Pod & Container Supervisor</div>
              </div>
              <div className="rounded bg-emerald-900/30 p-2 border border-emerald-800/40">
                <div className="font-bold text-emerald-300">kube-proxy</div>
                <div className="text-[9px] text-slate-400 mt-0.5">iptables / Service Routing</div>
              </div>
            </div>

            {/* Services on Data Plane */}
            {clusterState.services.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-cyan-400 flex items-center gap-1.5">
                  <span>🔌</span> Active Services ({clusterState.services.length})
                </div>
                <div className="grid gap-2">
                  {clusterState.services.map((svc, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-cyan-950/40 border border-cyan-800/60 p-3 flex justify-between items-center shadow-md font-mono"
                    >
                      <div>
                        <div className="text-xs font-bold text-cyan-200">{svc.name}</div>
                        <div className="text-[10px] text-cyan-400 mt-0.5">
                          {svc.type} • ClusterIP: {svc.clusterIP}
                        </div>
                      </div>
                      <div className="bg-cyan-900/50 px-2.5 py-1 rounded border border-cyan-700/50 text-[11px] text-cyan-200 font-bold">
                        {formatServicePortDisplay(svc.ports)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pods Running in CRI Container Runtime */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-emerald-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span>🐋</span> containerd / CRI — Running Pods ({clusterState.pods.length})
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Shared Network & Storage
                </span>
              </div>

              {clusterState.pods.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500 font-mono">
                  No Pods currently scheduled on this node.
                  <br />
                  <span className="text-blue-400">Run a kubectl command in the terminal to deploy!</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {clusterState.pods.map((p, i) => (
                    <div
                      key={p.name || i}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 shadow-md hover:border-emerald-500/70 transition-all font-mono text-xs"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              p.status === "Running"
                                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
                                : p.status === "Pending"
                                ? "bg-amber-400 animate-ping"
                                : "bg-rose-500"
                            }`}
                          />
                          <span className="font-bold text-slate-100 truncate">{p.name}</span>
                        </div>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            p.status === "Running"
                              ? "bg-emerald-900/80 text-emerald-300"
                              : "bg-amber-900/80 text-amber-300"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>

                      <div className="text-[10px] text-slate-400 space-y-0.5">
                        <div className="truncate">Image: {p.image}</div>
                        <div>IP: {p.ip || "10.244.0.5"}</div>
                        {p.ownerRef && (
                          <div className="text-purple-300 truncate">
                            Owner: {p.ownerRef.name}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
