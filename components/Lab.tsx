"use client";

import React, { useState, useEffect, useRef } from "react";
import { Lesson, ClusterState } from "@/engine/cluster-state";
import {
  executeCommand,
  ExecutionResult,
  DEFAULT_NODES,
  DEFAULT_VIRTUAL_FILES,
} from "@/engine/simulator";
import ControlPlaneBar from "@/components/ControlPlaneBar";
import ActionImpactCard from "@/components/ActionImpactCard";
import DataPlaneView from "@/components/DataPlaneView";
import TrafficAnimation from "@/components/TrafficAnimation";
import VimEditor from "@/components/VimEditor";
import { saveVirtualFile } from "@/engine/virtual-fs";

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
  const [activeVimFile, setActiveVimFile] = useState<string | null>(null);
  const [recentFlow, setRecentFlow] = useState<{
    flow: string[];
    description: string;
    timestamp: number;
  } | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<TerminalItem[]>([
    {
      id: "init-1",
      type: "system",
      text: "☸ Kubernetes Story Lab v2.0 — Interactive Learning Cluster",
    },
    {
      id: "init-2",
      type: "system",
      text: "Type 'help' for available kubectl & file commands, or follow the guided missions on the left.\n",
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [currentCommand, setCurrentCommand] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [stepCompleted, setStepCompleted] = useState(false);

  const [clusterState, setClusterState] = useState<ClusterState>({
    nodes: [...DEFAULT_NODES],
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
    files: { ...DEFAULT_VIRTUAL_FILES },
  });

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentLesson = lessons[activeLessonIdx] || lessons[0];
  const currentStep = currentLesson?.steps?.[activeStepIdx];

  // Initialize cluster state when lesson changes
  useEffect(() => {
    if (currentLesson) {
      const initPods = currentLesson.initialState?.pods || [];
      const initNodes = (currentLesson.initialState?.nodes || DEFAULT_NODES).map((n) => ({
        ...n,
        pods: initPods.filter((p) => p.node === n.name).map((p) => p.name),
      }));

      setClusterState((prev) => ({
        nodes: initNodes,
        pods: initPods.map((p, idx) => ({
          ...p,
          node: p.node || (idx % 2 === 0 ? "worker-node-1" : "worker-node-2"),
          ip: p.ip || `10.244.${(idx % 2) + 1}.${10 + idx}`,
          restarts: p.restarts ?? 0,
          age: p.age || "2m",
        })),
        replicaSets: currentLesson.initialState?.replicaSets || [],
        deployments: currentLesson.initialState?.deployments || [],
        daemonSets: currentLesson.initialState?.daemonSets || [],
        statefulSets: currentLesson.initialState?.statefulSets || [],
        jobs: currentLesson.initialState?.jobs || [],
        cronJobs: currentLesson.initialState?.cronJobs || [],
        services: currentLesson.initialState?.services || [],
        namespaces: currentLesson.initialState?.namespaces || [],
        configMaps: currentLesson.initialState?.configMaps || [],
        secrets: currentLesson.initialState?.secrets || [],
        files: currentLesson.initialState?.files || prev.files || { ...DEFAULT_VIRTUAL_FILES },
        lastActionImpact: undefined,
      }));

      setActiveStepIdx(0);
      setShowHint(false);
      setStepCompleted(false);
      setActiveVimFile(null);
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

    if (result.openVim) {
      setActiveVimFile(result.openVim);
      setCurrentCommand("");
      setTerminalOutput((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          type: "cmd",
          text: `learner@k8s:~$ ${cmd}`,
        },
        {
          id: `out-${Date.now()}`,
          type: "system",
          text: `Opened '${result.openVim}' in Vim editor. (Use :wq to save & return, or click buttons on top bar)`,
        },
      ]);
      return;
    }

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

  const handleVimSave = (filename: string, content: string) => {
    setClusterState((prev) => ({
      ...prev,
      files: {
        ...prev.files,
        [filename]: content,
      },
    }));

    setTerminalOutput((prev) => [
      ...prev,
      {
        id: `vim-save-${Date.now()}`,
        type: "success",
        text: `"${filename}" written. To apply this manifest to the cluster, run: kubectl apply -f ${filename}`,
      },
    ]);
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
    <div className="lab-shell flex h-screen w-screen flex-col text-slate-100 font-sans select-none overflow-hidden">
      {/* ================= TOP HEADER & LESSON NAVIGATOR ================= */}
      <header className="lab-header flex shrink-0 items-center justify-between border-b z-20">
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-bold text-white shadow-lg shadow-blue-500/25">
            ☸
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wide text-white">
                k8s labs
              </h1>
              <span className="rounded bg-blue-900/60 px-2 py-0.5 text-[10px] font-mono font-semibold text-blue-300 border border-blue-700/50">
                SIMULATOR
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Run commands & edit YAML. Watch Kubernetes reconcile.
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

      {/* ================= MAIN SPLIT LAYOUT ================= */}
      <div className="lab-main flex flex-1 overflow-hidden">
        {/* ================= LEFT SIDE: QUESTIONS & TERMINAL ================= */}
        <div className="lab-lesson-pane flex flex-col border-r overflow-hidden">
          {/* Upper Section: Clean Story & Challenge Questions */}
          <div className="lab-lesson-scroll flex-1 overflow-y-auto space-y-4 thin-scroll">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400">Guided workspace</div>
                <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-100">Lesson Challenge</h2>
              </div>
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-300">
                Learn → run → observe
              </span>
            </div>

            {/* Lesson Title & Intro Banner */}
            <div className="lab-card rounded-xl border p-4 shadow-lg">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                  Lesson {activeLessonIdx + 1} of {lessons.length}
                </span>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
                  Step {activeStepIdx + 1} of {totalSteps} ({progressPct}%)
                </span>
              </div>
              <h2 className="text-lg font-extrabold text-white tracking-tight">
                {currentLesson.title}
              </h2>
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                {currentLesson.intro}
              </p>
            </div>

            {/* Current Challenge / Step Card */}
            {currentStep && (
              <div
                className={`lab-step-card rounded-xl border p-4 shadow-xl transition-all ${
                  stepCompleted
                    ? "border-emerald-500/60 bg-emerald-950/20 shadow-emerald-950/30"
                    : "border-blue-500/50 bg-[#121c32] shadow-blue-950/20"
                }`}
              >
                {/* Step Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
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
                    <h3 className="text-xs font-bold text-white">
                      {currentStep.title || `Step ${activeStepIdx + 1}`}
                    </h3>
                  </div>

                  {stepCompleted ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 animate-pulse">
                      ✓ Mission Complete!
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-slate-400">
                      Step {activeStepIdx + 1} / {totalSteps}
                    </span>
                  )}
                </div>

                {/* Step Description */}
                <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line mb-3 font-sans">
                  {currentStep.description || currentStep.text || currentStep.prompt}
                </div>

                {/* Actionable Prompt Banner for Challenges */}
                {currentStep.type === "challenge" && currentStep.prompt && (
                  <div className="mb-3 rounded-lg bg-black/40 p-3 border border-amber-500/30 flex items-start gap-2.5">
                    <span className="text-amber-400 text-base">🎯</span>
                    <div className="flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        Your Action Required:
                      </div>
                      <p className="text-xs font-medium text-slate-100 mt-0.5">
                        {currentStep.prompt}
                      </p>
                    </div>
                  </div>
                )}

                {/* Hint Bar & Quick Action */}
                {currentStep.hint && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setShowHint(!showHint)}
                        className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                      >
                        💡 {showHint ? "Hide Hint" : "Need a Hint?"}
                      </button>
                    </div>

                    {showHint && (
                      <div className="mt-2 rounded-lg bg-black/60 p-2.5 border border-amber-500/30 flex items-center justify-between gap-3">
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

                {/* Continue Button for Observation / Non-challenge Steps */}
                {(currentStep.type !== "challenge" || stepCompleted) && (
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleNextStep}
                      className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-1.5"
                    >
                      {activeStepIdx === totalSteps - 1
                        ? "Finish & Next Lesson →"
                        : "Continue to Next Step →"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>          {/* Lower Section: Integrated Interactive Terminal or In-Terminal Vim Editor */}
          {activeVimFile ? (
            <div className="lab-terminal flex flex-col border-t h-[380px] p-2 bg-[#060b16] relative animate-fadeIn">
              <VimEditor
                filename={activeVimFile}
                initialContent={clusterState.files?.[activeVimFile]}
                onSave={(fn, fileContent) => {
                  setClusterState((prev) => ({
                    ...prev,
                    files: { ...(prev.files || {}), [fn]: fileContent },
                  }));
                  saveVirtualFile(fn, fileContent);
                }}
                onSaveAndExit={(fn, fileContent) => {
                  setClusterState((prev) => ({
                    ...prev,
                    files: { ...(prev.files || {}), [fn]: fileContent },
                  }));
                  saveVirtualFile(fn, fileContent);
                  const lineCount = fileContent.split("\n").length;
                  setTerminalOutput((prev) => [
                    ...prev,
                    {
                      id: `vim-save-exit-${Date.now()}`,
                      type: "system",
                      text: `"${fn}" ${lineCount}L, ${fileContent.length}B written. (Exited Vim)`,
                    },
                  ]);
                  setActiveVimFile(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                onClose={() => {
                  setActiveVimFile(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                onExit={() => {
                  setActiveVimFile(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
              />
            </div>
          ) : (
            <div
              className="lab-terminal flex flex-col border-t font-mono text-xs cursor-text relative select-text terminal-glow transition-all duration-300"
              onClick={() => inputRef.current?.focus()}
            >
              {/* Terminal Title Bar */}
              <div className="lab-terminal-bar flex items-center justify-between px-4 py-2 border-b select-none">
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/80"></span>
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80"></span>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></span>
                  <span className="ml-2 text-[11px] font-semibold text-slate-300">
                    terminal — simulated kubectl & vim
                  </span>
                </div>

                {/* Quick Vim Manifest Launchers & Controls */}
                <div className="flex items-center space-x-2 text-[11px]">
                  <span className="text-slate-500 hidden sm:inline">Vim:</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveVimFile("pod.yaml");
                    }}
                    className="rounded bg-sky-950/70 hover:bg-sky-900/90 text-sky-300 px-1.5 py-0.5 text-[10px] font-mono border border-sky-800/40 transition-colors"
                    title="Open pod.yaml in Vim"
                  >
                    pod.yaml
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveVimFile("deployment.yaml");
                    }}
                    className="rounded bg-sky-950/70 hover:bg-sky-900/90 text-sky-300 px-1.5 py-0.5 text-[10px] font-mono border border-sky-800/40 transition-colors"
                    title="Open deployment.yaml in Vim"
                  >
                    deployment.yaml
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveVimFile("service.yaml");
                    }}
                    className="rounded bg-sky-950/70 hover:bg-sky-900/90 text-sky-300 px-1.5 py-0.5 text-[10px] font-mono border border-sky-800/40 transition-colors"
                    title="Open service.yaml in Vim"
                  >
                    service.yaml
                  </button>

                  <span className="text-slate-600">|</span>

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
                  placeholder="Type a command (e.g. vim pod.yaml, kubectl apply -f pod.yaml)..."
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                  className="flex-1 bg-transparent text-slate-100 outline-none placeholder:text-slate-600 font-mono text-xs"
                />
              </form>
            </div>
          )}
        </div>

        {/* ================= RIGHT SIDE: KUBERNETES PROCESSES ================= */}
        <div className="lab-simulation-pane flex flex-col overflow-y-auto space-y-4 thin-scroll">
          {/* Header */}
          <div className="lab-sim-header flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse" />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-400">Kubernetes processes</div>
                <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-100">Live Cluster Simulation</h2>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400">
              <span className="rounded bg-slate-800/80 px-2 py-0.5 border border-slate-700/60">
                Namespace: default
              </span>
              <span className="rounded bg-emerald-950/60 px-2 py-0.5 border border-emerald-700/50 text-emerald-300 font-bold">
                {clusterState.pods.length} {clusterState.pods.length === 1 ? "Pod" : "Pods"} Online
              </span>
            </div>
          </div>

          {/* 1. Soft Ambient Control Plane Bar */}
          <ControlPlaneBar
            recentFlow={recentFlow}
            clusterState={clusterState}
            activeComponents={
              clusterState.lastActionImpact
                ? ["kube-apiserver", "kube-scheduler", "kube-controller-manager", "etcd"]
                : recentFlow?.flow || []
            }
          />

          {/* 2. Prominent "What Did I Just Do?" Action Impact Banner */}
          <ActionImpactCard
            impact={clusterState.lastActionImpact}
            recentFlow={recentFlow}
            lastCommand={commandHistory[commandHistory.length - 1]}
            clusterState={clusterState}
          />

          {/* 3. Live Traffic / kube-proxy Animation */}
          <TrafficAnimation services={clusterState.services} pods={clusterState.pods} />

          {/* 4. Spotlit Data Plane & Multi-Node Container Bays */}
          <DataPlaneView clusterState={clusterState} />

          {/* 5. Configuration & Secrets Storage */}
          {(clusterState.configMaps.length > 0 || clusterState.secrets.length > 0) && (
            <div className="rounded-xl border border-slate-800 bg-[#091120]/80 p-3.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Cluster Storage & Configuration Data</span>
                <span className="text-[10px] font-mono text-slate-500">etcd Config Store</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                {clusterState.configMaps.map((cm, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-emerald-950/30 border border-emerald-800/50 p-2.5 text-emerald-200"
                  >
                    <div className="flex items-center gap-1.5 font-bold">
                      <span>📄</span>
                      <span className="truncate">{cm.name}</span>
                    </div>
                    <div className="text-[10px] text-emerald-400 mt-1">
                      {Object.keys(cm.data || {}).length} keys mapped
                    </div>
                  </div>
                ))}
                {clusterState.secrets.map((sec, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-rose-950/30 border border-rose-800/50 p-2.5 text-rose-200"
                  >
                    <div className="flex items-center gap-1.5 font-bold">
                      <span>🔐</span>
                      <span className="truncate">{sec.name}</span>
                    </div>
                    <div className="text-[10px] text-rose-400 mt-1">
                      {sec.type} • {Object.keys(sec.data || {}).length || sec.dataKeys?.length || 0} base64 keys
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
