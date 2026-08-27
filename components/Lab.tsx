'use client'

import React, { useState, useEffect, useRef } from 'react';
import { 
  Lesson, ClusterState, Pod, ReplicaSet, Deployment,
  DaemonSet, StatefulSet, Job, CronJob, Service,
  Namespace, ConfigMapResource, SecretResource 
} from '@/engine/cluster-state';
import { executeCommand } from '@/engine/simulator';

export default function Lab({ lessons }: { lessons: Lesson[] }) {
  const [activeLesson, setActiveLesson] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [terminalOutput, setTerminalOutput] = useState<{ type: 'cmd' | 'out', text: string }[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentCommand, setCurrentCommand] = useState('');
  const [clusterState, setClusterState] = useState<ClusterState>({
    pods: [], replicaSets: [], deployments: [], daemonSets: [],
    statefulSets: [], jobs: [], cronJobs: [], services: [],
    namespaces: [], configMaps: [], secrets: [],
  });
  const [showBehindTheScenes, setShowBehindTheScenes] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const lesson = lessons[activeLesson];
  const step = lesson?.steps?.[activeStep];

  useEffect(() => {
    // Initialize cluster state from lesson's initialState when lesson changes
    if (lesson?.initialState) {
      setClusterState({
        pods: lesson.initialState.pods || [],
        replicaSets: lesson.initialState.replicaSets || [],
        deployments: lesson.initialState.deployments || [],
        daemonSets: lesson.initialState.daemonSets || [],
        statefulSets: lesson.initialState.statefulSets || [],
        jobs: lesson.initialState.jobs || [],
        cronJobs: lesson.initialState.cronJobs || [],
        services: lesson.initialState.services || [],
        namespaces: lesson.initialState.namespaces || [],
        configMaps: lesson.initialState.configMaps || [],
        secrets: lesson.initialState.secrets || [],
      });
    } else {
      setClusterState({
        pods: [], replicaSets: [], deployments: [], daemonSets: [],
        statefulSets: [], jobs: [], cronJobs: [], services: [],
        namespaces: [], configMaps: [], secrets: [],
      });
    }
  }, [activeLesson, lesson]);

  const scrollToBottom = () => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [terminalOutput]);

  const handleCommand = (cmd: string) => {
    if (!cmd.trim()) return;
    
    if (cmd.trim() === 'clear') {
      setTerminalOutput([]);
      setCurrentCommand('');
      return;
    }

    const { output, newState, isCorrect } = executeCommand(cmd, clusterState, step);
    
    setTerminalOutput(prev => [
      ...prev, 
      { type: 'cmd', text: cmd },
      ...(output ? [{ type: 'out' as const, text: output }] : [])
    ]);
    
    if (newState) {
      setClusterState(newState);
    }
    
    setCommandHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);
    setCurrentCommand('');

    if (isCorrect && activeStep < lesson.steps.length - 1) {
      setTimeout(() => {
        setActiveStep(s => s + 1);
        setShowHint(false);
        setShowBehindTheScenes(false);
      }, 1000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(currentCommand);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIndex = historyIndex + 1;
        if (nextIndex < commandHistory.length) {
          setHistoryIndex(nextIndex);
          setCurrentCommand(commandHistory[commandHistory.length - 1 - nextIndex]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setCurrentCommand(commandHistory[commandHistory.length - 1 - nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentCommand('');
      }
    }
  };

  if (!lesson) return <div className="flex h-screen items-center justify-center bg-[#0b101b] text-white">Loading...</div>;

  return (
    <div className="flex flex-col h-screen bg-[#0b101b] text-gray-200 font-sans">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between px-6 py-4 bg-[#121826] border-b border-gray-800">
        <div className="flex items-center gap-4">
          <select 
            className="bg-[#1e293b] text-white px-4 py-2 rounded-md border border-gray-700 outline-none focus:border-blue-500 min-w-[300px]"
            value={activeLesson}
            onChange={(e) => {
              setActiveLesson(Number(e.target.value));
              setActiveStep(0);
              setShowHint(false);
              setShowBehindTheScenes(false);
            }}
          >
            {lessons.map((l, i) => (
              <option key={i} value={i}>{i + 1}. {l.title}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button 
              disabled={activeLesson === 0}
              onClick={() => {
                setActiveLesson(l => l - 1);
                setActiveStep(0);
              }}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800 rounded transition"
            >
              &larr; Prev
            </button>
            <button 
              disabled={activeLesson === lessons.length - 1}
              onClick={() => {
                setActiveLesson(l => l + 1);
                setActiveStep(0);
              }}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:hover:bg-gray-800 rounded transition"
            >
              Next &rarr;
            </button>
          </div>
        </div>
        <div className="text-sm text-gray-400 font-medium bg-gray-800/50 px-4 py-2 rounded-full">
          Lesson {activeLesson + 1} / {lessons.length}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Instructions & Terminal */}
        <div className="w-1/2 flex flex-col border-r border-gray-800">
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0f1422]">
            {/* Step Card */}
            {step && (
              <div className="bg-[#1a2335] rounded-lg p-6 border border-gray-700 shadow-xl">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-blue-400">Step {activeStep + 1}: {step.title || step.type}</h2>
                  <span className="text-xs font-mono bg-blue-900/50 text-blue-300 px-3 py-1 rounded-full border border-blue-800/50">
                    {activeStep + 1} / {lesson.steps.length}
                  </span>
                </div>
                <div className="prose prose-invert max-w-none text-gray-300 mb-6 whitespace-pre-wrap">{step.description || step.prompt || step.text || ''}</div>
                
                <div className="flex gap-3 mb-4">
                  {step.hint && (
                    <button 
                      onClick={() => setShowHint(!showHint)}
                      className="text-sm px-4 py-2 bg-yellow-900/30 text-yellow-500 rounded hover:bg-yellow-900/50 transition border border-yellow-700/50"
                    >
                      💡 {showHint ? 'Hide Hint' : 'Show Hint'}
                    </button>
                  )}
                </div>
                
                {showHint && step.hint && (
                  <div className="p-4 bg-yellow-900/20 border border-yellow-700/30 rounded mb-4 text-yellow-200/80">
                    {step.hint}
                  </div>
                )}
              </div>
            )}

            {/* Behind the Scenes Panel */}
            {step?.behindTheScenes && (
              <div className="bg-[#161329] border border-[#2d224d] rounded-lg overflow-hidden shadow-lg">
                <button 
                  onClick={() => setShowBehindTheScenes(!showBehindTheScenes)}
                  className="w-full flex justify-between items-center px-6 py-4 bg-[#1b1735] hover:bg-[#201b3d] transition-colors"
                >
                  <span className="font-semibold text-purple-300 flex items-center gap-2">
                    🔧 Behind the Scenes
                  </span>
                  <span className="text-purple-400">{showBehindTheScenes ? '▲' : '▼'}</span>
                </button>
                {showBehindTheScenes && (
                  <div className="p-6 border-t border-[#2d224d] bg-[#161329] text-purple-200">
                    <div className="whitespace-pre-wrap font-sans text-sm mb-6 leading-relaxed">
                      {step.behindTheScenes}
                    </div>
                    <div className="bg-black/50 p-4 rounded text-center text-xs font-mono text-purple-400 border border-purple-900/50 shadow-inner">
                      kubectl &rarr; API Server &rarr; etcd &rarr; Scheduler &rarr; kubelet &rarr; CRI
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Terminal */}
          <div className="h-64 min-h-[16rem] bg-[#05080f] flex flex-col border-t border-gray-800 relative resize-y overflow-auto">
            <div className="flex items-center justify-between px-4 py-2 bg-[#121826] border-b border-gray-800 text-xs font-mono text-gray-500 sticky top-0 z-10 shadow-md">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                <span className="ml-2">terminal</span>
              </div>
              <button 
                onClick={() => { setTerminalOutput([]); setCurrentCommand(''); }}
                className="hover:text-white transition px-2 py-1 hover:bg-gray-800 rounded"
                title="Clear Terminal"
              >
                clear
              </button>
            </div>
            
            <div className="flex-1 p-4 font-mono text-sm overflow-y-auto" onClick={() => document.getElementById('term-input')?.focus()}>
              {terminalOutput.map((item, i) => (
                <div key={i} className="mb-2">
                  {item.type === 'cmd' ? (
                    <div className="flex text-gray-300">
                      <span className="text-green-400 mr-2">$</span>
                      {item.text}
                    </div>
                  ) : (
                    <div className="text-gray-400 whitespace-pre-wrap pl-4 break-words">{item.text}</div>
                  )}
                </div>
              ))}
              <div className="flex text-gray-300 mt-2">
                <span className="text-green-400 mr-2">$</span>
                <input
                  id="term-input"
                  type="text"
                  value={currentCommand}
                  onChange={(e) => setCurrentCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent outline-none focus:ring-0 p-0 border-none w-full text-gray-200 placeholder-gray-700"
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>

        {/* Right Panel: Cluster State Visualizer */}
        <div className="w-1/2 bg-[#0c121e] overflow-y-auto p-6 custom-scrollbar">
          <h2 className="text-lg font-bold mb-6 text-gray-400 uppercase tracking-widest flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></span>
            Cluster State
          </h2>

          <div className="space-y-6 pb-12">
            
            {/* Deployments */}
            {clusterState?.deployments && clusterState.deployments.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
                  <span className="text-lg">📦</span> Deployments
                </h3>
                <div className="grid gap-3">
                  {clusterState.deployments.map((d, i) => (
                    <div key={i} className="bg-blue-900/20 border border-blue-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div>
                        <div className="font-mono text-blue-300 font-medium">{d.name}</div>
                        <div className="text-xs text-blue-500/70 mt-1">{d.namespace || 'default'}</div>
                      </div>
                      <div className="text-right bg-blue-900/40 px-3 py-1 rounded-md border border-blue-800/50">
                        <div className="text-sm text-blue-200">Replicas: <span className="font-bold">{d.available || d.upToDate || 0}/{d.replicas}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ReplicaSets */}
            {clusterState?.replicaSets && clusterState.replicaSets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-2">
                  <span className="text-lg">🔄</span> ReplicaSets
                </h3>
                <div className="grid gap-3">
                  {clusterState.replicaSets.map((rs, i) => (
                    <div key={i} className="bg-purple-900/20 border border-purple-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div className="font-mono text-purple-300 font-medium">{rs.name}</div>
                      <div className="text-sm text-purple-200 bg-purple-900/40 px-3 py-1 rounded-md border border-purple-800/50">
                        Replicas: <span className="font-bold">{rs.readyReplicas || 0}/{rs.desiredReplicas}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* StatefulSets */}
            {clusterState?.statefulSets && clusterState.statefulSets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-indigo-400 flex items-center gap-2">
                  <span className="text-lg">💾</span> StatefulSets
                </h3>
                <div className="grid gap-3">
                  {clusterState.statefulSets.map((ss, i) => (
                    <div key={i} className="bg-indigo-900/20 border border-indigo-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div className="font-mono text-indigo-300 font-medium">{ss.name}</div>
                      <div className="text-sm text-indigo-200 bg-indigo-900/40 px-3 py-1 rounded-md border border-indigo-800/50">
                        Replicas: <span className="font-bold">{ss.readyReplicas || 0}/{ss.replicas}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DaemonSets */}
            {clusterState?.daemonSets && clusterState.daemonSets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                  <span className="text-lg">👻</span> DaemonSets
                </h3>
                <div className="grid gap-3">
                  {clusterState.daemonSets.map((ds, i) => (
                    <div key={i} className="bg-amber-900/20 border border-amber-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div className="font-mono text-amber-300 font-medium">{ds.name}</div>
                      <div className="text-sm text-amber-200 bg-amber-900/40 px-3 py-1 rounded-md border border-amber-800/50">
                        Ready: <span className="font-bold">{ds.readyPods || ds.currentPods || 0}/{ds.desiredNodes}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Jobs */}
            {clusterState?.jobs && clusterState.jobs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-teal-400 flex items-center gap-2">
                  <span className="text-lg">🎯</span> Jobs
                </h3>
                <div className="grid gap-3">
                  {clusterState.jobs.map((job, i) => (
                    <div key={i} className="bg-teal-900/20 border border-teal-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div className="font-mono text-teal-300 font-medium">{job.name}</div>
                      <div className="text-sm text-teal-200 bg-teal-900/40 px-3 py-1 rounded-md border border-teal-800/50">
                        Status: <span className="font-bold">{job.status === 'Complete' || job.succeeded ? 'Complete' : 'Active'}</span> ({job.succeeded || 0}/{job.completions})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pods */}
            {clusterState?.pods && clusterState.pods.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                  <span className="text-lg">🐋</span> Pods
                </h3>
                <div className="grid gap-3">
                  {clusterState.pods.map((p, i) => (
                    <div key={i} className="bg-green-900/20 border border-green-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div>
                        <div className="font-mono text-green-300 font-medium flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${p.status === 'Running' ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]' : p.status === 'Pending' ? 'bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.8)]' : 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]'}`}></span>
                          {p.name}
                        </div>
                      </div>
                      <div className="text-sm text-green-200 bg-green-900/40 px-3 py-1 rounded-md border border-green-800/50 font-medium">
                        {p.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Services */}
            {clusterState?.services && clusterState.services.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                  <span className="text-lg">🔌</span> Services
                </h3>
                <div className="grid gap-3">
                  {clusterState.services.map((svc, i) => (
                    <div key={i} className="bg-cyan-900/20 border border-cyan-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div>
                        <div className="font-mono text-cyan-300 font-medium">{svc.name}</div>
                        <div className="text-xs text-cyan-500/80 mt-1 uppercase tracking-wider">{svc.type} &bull; {svc.clusterIP}</div>
                      </div>
                      <div className="text-sm text-cyan-200 bg-cyan-900/40 px-3 py-1 rounded-md border border-cyan-800/50">
                        {typeof svc.ports === 'string' ? svc.ports : Array.isArray(svc.ports) ? (svc.ports as any[]).map((p: any) => `${p.port}:${p.nodePort || '-'}/${p.protocol || 'TCP'}`).join(', ') : '80/TCP'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ConfigMaps */}
            {clusterState?.configMaps && clusterState.configMaps.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                  <span className="text-lg">📄</span> ConfigMaps
                </h3>
                <div className="grid gap-3">
                  {clusterState.configMaps.map((cm, i) => (
                    <div key={i} className="bg-emerald-900/20 border border-emerald-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div className="font-mono text-emerald-300 font-medium">{cm.name}</div>
                      <div className="text-sm text-emerald-200 bg-emerald-900/40 px-3 py-1 rounded-md border border-emerald-800/50">
                        {Object.keys(cm.data || {}).length} keys
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Secrets */}
            {clusterState?.secrets && clusterState.secrets.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-rose-400 flex items-center gap-2">
                  <span className="text-lg">🔐</span> Secrets
                </h3>
                <div className="grid gap-3">
                  {clusterState.secrets.map((sec, i) => (
                    <div key={i} className="bg-rose-900/20 border border-rose-800/50 p-4 rounded-lg flex justify-between items-center shadow-sm">
                      <div>
                        <div className="font-mono text-rose-300 font-medium">{sec.name}</div>
                        <div className="text-xs text-rose-500/80 mt-1 uppercase tracking-wider">{sec.type}</div>
                      </div>
                      <div className="text-sm text-rose-200 bg-rose-900/40 px-3 py-1 rounded-md border border-rose-800/50">
                        {Object.keys(sec.data || {}).length} keys
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Namespaces */}
            {clusterState?.namespaces && clusterState.namespaces.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
                  <span className="text-lg">🏷️</span> Namespaces
                </h3>
                <div className="flex flex-wrap gap-2">
                  {clusterState.namespaces.map((ns, i) => (
                    <div key={i} className="bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-md text-xs font-mono text-gray-300 flex items-center gap-2 shadow-sm">
                      {ns.name}
                      <span className={`w-2 h-2 rounded-full ${ns.status === 'Active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Empty State */}
            {Object.values(clusterState).every(v => !Array.isArray(v) || v.length === 0) && (
              <div className="flex flex-col items-center justify-center p-12 text-gray-500 border-2 border-gray-800 border-dashed rounded-xl bg-[#111827]/50">
                <span className="text-4xl mb-4 opacity-50">🛸</span>
                <p className="text-lg font-medium">Cluster is empty</p>
                <p className="text-sm mt-1 opacity-70">Run some commands to create resources</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
