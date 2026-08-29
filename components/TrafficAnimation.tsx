"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Service, Pod, ServicePort } from "@/engine/cluster-state";

export interface TrafficAnimationProps {
  services?: Service[];
  pods?: Pod[];
  activeService?: Service | null;
  onSelectService?: (service: Service) => void;
  className?: string;
}

interface PacketLog {
  id: string;
  timestamp: string;
  clientIp: string;
  serviceVip: string;
  servicePort: string | number;
  podName: string;
  podIp: string;
  podNode: string;
  protocol: "HTTP" | "TCP" | "gRPC";
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  natRule: string;
}

interface ActivePacket {
  id: string;
  startTime: number;
  duration: number; // ms
  clientPoint: { x: number; y: number };
  vipPoint: { x: number; y: number };
  proxyPoint: { x: number; y: number };
  podPoint: { x: number; y: number };
  podIndex: number;
  targetPodName: string;
  protocol: "HTTP" | "TCP" | "gRPC";
  color: string;
}

export default function TrafficAnimation({
  services = [],
  pods = [],
  activeService: propActiveService,
  onSelectService,
  className = "",
}: TrafficAnimationProps) {
  // 1. Fallback / Mock Data for Demo & Explanatory Clarity
  const fallbackServices = useMemo<Service[]>(
    () => [
      {
        name: "frontend-svc",
        type: "NodePort",
        clusterIP: "10.96.142.80",
        ports: [
          { port: 80, nodePort: 30080, targetPort: 8080, protocol: "TCP" },
        ],
        selector: { app: "frontend" },
        age: "12m",
      },
      {
        name: "backend-svc",
        type: "ClusterIP",
        clusterIP: "10.96.220.15",
        ports: [{ port: 80, targetPort: 5000, protocol: "TCP" }],
        selector: { app: "backend" },
        age: "45m",
      },
    ],
    []
  );

  const fallbackPods = useMemo<Pod[]>(
    () => [
      {
        name: "backend-7b8f6d-x49kl",
        image: "backend:v2.1",
        status: "Running",
        node: "worker-node-1",
        ip: "10.244.1.24",
        labels: { app: "backend", tier: "api" },
        restarts: 0,
        age: "45m",
      },
      {
        name: "backend-7b8f6d-m38pz",
        image: "backend:v2.1",
        status: "Running",
        node: "worker-node-2",
        ip: "10.244.2.19",
        labels: { app: "backend", tier: "api" },
        restarts: 0,
        age: "45m",
      },
      {
        name: "backend-7b8f6d-r82qw",
        image: "backend:v2.1",
        status: "Running",
        node: "worker-node-1",
        ip: "10.244.1.37",
        labels: { app: "backend", tier: "api" },
        restarts: 0,
        age: "12m",
      },
    ],
    []
  );

  // Available services list
  const availableServices = useMemo(() => {
    if (services && services.length > 0) return services;
    return fallbackServices;
  }, [services, fallbackServices]);

  // Active selected service
  const [selectedServiceName, setSelectedServiceName] = useState<string>(
    propActiveService?.name || availableServices[0]?.name || "backend-svc"
  );

  useEffect(() => {
    if (propActiveService) {
      setSelectedServiceName(propActiveService.name);
    } else if (!availableServices.some((s) => s.name === selectedServiceName)) {
      setSelectedServiceName(availableServices[0]?.name || "backend-svc");
    }
  }, [propActiveService, availableServices, selectedServiceName]);

  const currentService = useMemo(() => {
    return (
      availableServices.find((s) => s.name === selectedServiceName) ||
      availableServices[0]
    );
  }, [availableServices, selectedServiceName]);

  // Match healthy pods for the active service
  const matchingPods = useMemo<Pod[]>(() => {
    const candidatePods = pods && pods.length > 0 ? pods : fallbackPods;
    if (!currentService || !currentService.selector) {
      return candidatePods.filter((p) => p.status === "Running");
    }
    const selectorEntries = Object.entries(currentService.selector);
    if (selectorEntries.length === 0) {
      return candidatePods.filter((p) => p.status === "Running");
    }
    const matched = candidatePods.filter((p) => {
      if (p.status !== "Running") return false;
      if (!p.labels) return false;
      return selectorEntries.every(([k, v]) => p.labels?.[k] === v);
    });
    return matched.length > 0
      ? matched
      : candidatePods.filter((p) => p.status === "Running");
  }, [pods, fallbackPods, currentService]);

  // Simulation Controls State
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [simulationSpeed, setSimulationSpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [protocol, setProtocol] = useState<"HTTP" | "TCP" | "gRPC">("HTTP");
  const [loadBalancingMode, setLoadBalancingMode] = useState<"round-robin" | "random" | "pinned">("round-robin");
  const [pinnedPodIndex, setPinnedPodIndex] = useState<number | null>(null);
  const [kubeProxyEngine, setKubeProxyEngine] = useState<"iptables" | "IPVS">("iptables");
  const [showPacketInspector, setShowPacketInspector] = useState<boolean>(true);

  // Statistics State
  const [totalPackets, setTotalPackets] = useState<number>(0);
  const [deliveredPackets, setDeliveredPackets] = useState<number>(0);
  const [podHitStats, setPodHitStats] = useState<Record<string, number>>({});
  const [lastHitPodName, setLastHitPodName] = useState<string | null>(null);
  const [packetLogs, setPacketLogs] = useState<PacketLog[]>([]);

  // Animation active packets list
  const [activePackets, setActivePackets] = useState<ActivePacket[]>([]);
  const packetSequenceRef = useRef<number>(0);
  const roundRobinIndexRef = useRef<number>(0);
  const requestAnimationRef = useRef<number | null>(null);

  // Speed multiplier
  const durationMs = useMemo(() => {
    switch (simulationSpeed) {
      case "slow":
        return 2200;
      case "fast":
        return 850;
      case "normal":
      default:
        return 1400;
    }
  }, [simulationSpeed]);

  // Layout Node Coordinates for SVG Rendering
  const svgWidth = 860;
  const svgHeight = 340;

  const clientPoint = { x: 70, y: 170 };
  const serviceVipPoint = { x: 260, y: 170 };
  const kubeProxyPoint = { x: 470, y: 170 };

  // Compute endpoint target positions dynamically
  const endpointPositions = useMemo(() => {
    const total = Math.max(1, matchingPods.length);
    const startY = 70;
    const endY = 270;
    const stepY = total > 1 ? (endY - startY) / (total - 1) : 0;

    return matchingPods.map((pod, idx) => ({
      pod,
      point: {
        x: 740,
        y: total === 1 ? 170 : startY + idx * stepY,
      },
    }));
  }, [matchingPods]);

  // Dispatch a simulated packet
  const sendPacket = useCallback(() => {
    if (matchingPods.length === 0) return;

    let targetIdx = 0;
    if (loadBalancingMode === "pinned" && pinnedPodIndex !== null && pinnedPodIndex < matchingPods.length) {
      targetIdx = pinnedPodIndex;
    } else if (loadBalancingMode === "random") {
      targetIdx = Math.floor(Math.random() * matchingPods.length);
    } else {
      targetIdx = roundRobinIndexRef.current % matchingPods.length;
      roundRobinIndexRef.current = (roundRobinIndexRef.current + 1) % matchingPods.length;
    }

    const targetPod = matchingPods[targetIdx];
    const targetPoint = endpointPositions[targetIdx]?.point || { x: 740, y: 170 };
    const packetId = `pkt-${Date.now()}-${packetSequenceRef.current++}`;

    const protocolColors = {
      HTTP: "#38bdf8", // Sky blue
      TCP: "#34d399",  // Emerald
      gRPC: "#a78bfa", // Purple
    };

    const newPacket: ActivePacket = {
      id: packetId,
      startTime: performance.now(),
      duration: durationMs,
      clientPoint,
      vipPoint: serviceVipPoint,
      proxyPoint: kubeProxyPoint,
      podPoint: targetPoint,
      podIndex: targetIdx,
      targetPodName: targetPod.name,
      protocol,
      color: protocolColors[protocol],
    };

    setTotalPackets((prev) => prev + 1);
    setActivePackets((prev) => [...prev, newPacket]);

    // Format service port
    let servicePortVal: string | number = 80;
    if (currentService?.ports) {
      if (typeof currentService.ports === "string") {
        servicePortVal = currentService.ports;
      } else if (Array.isArray(currentService.ports) && currentService.ports[0]) {
        servicePortVal = currentService.ports[0].port;
      }
    }

    // Schedule arrival handling
    setTimeout(() => {
      setDeliveredPackets((prev) => prev + 1);
      setLastHitPodName(targetPod.name);
      setPodHitStats((prev) => ({
        ...prev,
        [targetPod.name]: (prev[targetPod.name] || 0) + 1,
      }));

      // Append Packet Log
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${Math.floor(
        now.getMilliseconds() / 10
      )
        .toString()
        .padStart(2, "0")}`;

      const httpMethods = ["GET", "POST", "GET", "PUT"];
      const httpPaths = ["/api/v1/data", "/healthz", "/items/42", "/metrics"];
      const randomMethod = httpMethods[Math.floor(Math.random() * httpMethods.length)];
      const randomPath = httpPaths[Math.floor(Math.random() * httpPaths.length)];

      const newLog: PacketLog = {
        id: packetId,
        timestamp: timeStr,
        clientIp: "192.168.1.100:54" + (100 + (packetSequenceRef.current % 800)),
        serviceVip: currentService?.clusterIP || "10.96.0.1",
        servicePort: servicePortVal,
        podName: targetPod.name,
        podIp: targetPod.ip || "10.244.1.5",
        podNode: targetPod.node || "worker-node-1",
        protocol,
        method: protocol === "HTTP" ? randomMethod : protocol === "gRPC" ? "RPC /Stream" : "SYN/ACK",
        path: protocol === "HTTP" ? randomPath : protocol === "gRPC" ? "ClusterService.Query" : ":8080",
        statusCode: 200,
        latencyMs: Number((0.8 + Math.random() * 1.8).toFixed(1)),
        natRule:
          kubeProxyEngine === "iptables"
            ? `-m statistic --mode random --probability ${(1 / matchingPods.length).toFixed(2)} -j DNAT`
            : `IPVS rr -> ${targetPod.ip}:8080`,
      };

      setPacketLogs((prev) => [newLog, ...prev.slice(0, 19)]);
    }, durationMs * 0.95);
  }, [
    matchingPods,
    loadBalancingMode,
    pinnedPodIndex,
    endpointPositions,
    durationMs,
    clientPoint,
    serviceVipPoint,
    kubeProxyPoint,
    protocol,
    currentService,
    kubeProxyEngine,
  ]);

  // Auto-traffic interval
  useEffect(() => {
    if (!isSimulating) return;

    const intervalMs = simulationSpeed === "fast" ? 700 : simulationSpeed === "slow" ? 2400 : 1300;
    const interval = setInterval(() => {
      sendPacket();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isSimulating, simulationSpeed, sendPacket]);

  // Clean expired packets
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = performance.now();
      setActivePackets((prev) =>
        prev.filter((pkt) => now - pkt.startTime < pkt.duration + 200)
      );
    }, 300);

    return () => clearInterval(cleanupInterval);
  }, []);

  // Compute bezier path string between two points
  const getCurvePath = (
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    const dx = p2.x - p1.x;
    const cx1 = p1.x + dx * 0.5;
    const cy1 = p1.y;
    const cx2 = p1.x + dx * 0.5;
    const cy2 = p2.y;
    return `M ${p1.x} ${p1.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p2.x} ${p2.y}`;
  };

  // Interpolate along multi-segment path: Client -> Service VIP -> kube-proxy -> Pod Endpoint
  const getPacketCoordinates = (
    pkt: ActivePacket,
    now: number
  ): { x: number; y: number; progress: number; stage: string } => {
    const elapsed = now - pkt.startTime;
    const progress = Math.min(1, Math.max(0, elapsed / pkt.duration));

    // Stage 1: Client to Service VIP (0.0 to 0.3)
    if (progress <= 0.3) {
      const subProgress = progress / 0.3;
      const x = pkt.clientPoint.x + (pkt.vipPoint.x - pkt.clientPoint.x) * subProgress;
      const y = pkt.clientPoint.y + (pkt.vipPoint.y - pkt.clientPoint.y) * subProgress;
      return { x, y, progress, stage: "client-to-vip" };
    }
    // Stage 2: Service VIP to kube-proxy (0.3 to 0.55)
    else if (progress <= 0.55) {
      const subProgress = (progress - 0.3) / 0.25;
      const x = pkt.vipPoint.x + (pkt.proxyPoint.x - pkt.vipPoint.x) * subProgress;
      const y = pkt.vipPoint.y + (pkt.proxyPoint.y - pkt.vipPoint.y) * subProgress;
      return { x, y, progress, stage: "vip-to-proxy" };
    }
    // Stage 3: kube-proxy to Pod Endpoint (0.55 to 1.0)
    else {
      const t = (progress - 0.55) / 0.45;
      const p0 = pkt.proxyPoint;
      const p3 = pkt.podPoint;
      const dx = p3.x - p0.x;
      const p1 = { x: p0.x + dx * 0.5, y: p0.y };
      const p2 = { x: p0.x + dx * 0.5, y: p3.y };

      // Cubic Bezier interpolation: B(t) = (1-t)^3*p0 + 3(1-t)^2*t*p1 + 3(1-t)*t^2*p2 + t^3*p3
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
      const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

      return { x, y, progress, stage: "proxy-to-pod" };
    }
  };

  // Render loop timestamp ticker
  const [renderTime, setRenderTime] = useState<number>(performance.now());
  useEffect(() => {
    let frameId: number;
    const updateTicker = () => {
      setRenderTime(performance.now());
      frameId = requestAnimationFrame(updateTicker);
    };
    frameId = requestAnimationFrame(updateTicker);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const formatPort = (port: string | number | ServicePort[] | undefined) => {
    if (!port) return "80";
    if (typeof port === "number" || typeof port === "string") return port;
    if (Array.isArray(port) && port[0]) return port[0].port;
    return "80";
  };

  return (
    <div
      className={`traffic-visualizer-container rounded-2xl border border-blue-500/30 bg-[#09111e] p-5 shadow-2xl space-y-4 font-sans ${className}`}
    >
      {/* ================= TOP HEADER & STATS BAR ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2b48] pb-4">
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/25">
            <span className="text-base animate-pulse">⚡</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-wide text-white">
                Live Traffic & Service Mesh Visualizer
              </h3>
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${
                  isSimulating
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSimulating ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {isSimulating ? "Live Routing" : "Paused"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Interactive packet visualizer demonstrating Service VIP & kube-proxy DNAT load balancing
            </p>
          </div>
        </div>

        {/* Quick Stats Counter Badges */}
        <div className="flex items-center space-x-2 text-[11px] font-mono">
          <div className="rounded-lg bg-[#0e1b30] px-3 py-1.5 border border-blue-900/60 shadow-inner flex items-center gap-2">
            <span className="text-slate-400">Dispatched:</span>
            <span className="font-bold text-sky-400">{totalPackets}</span>
          </div>
          <div className="rounded-lg bg-[#0e1b30] px-3 py-1.5 border border-emerald-900/60 shadow-inner flex items-center gap-2">
            <span className="text-slate-400">Delivered:</span>
            <span className="font-bold text-emerald-400">{deliveredPackets}</span>
          </div>
          <div className="rounded-lg bg-[#0e1b30] px-3 py-1.5 border border-purple-900/60 shadow-inner flex items-center gap-2">
            <span className="text-slate-400">Active Endpoints:</span>
            <span className="font-bold text-purple-300">{matchingPods.length}</span>
          </div>
        </div>
      </div>

      {/* ================= INTERACTIVE CONTROLS TOOLBAR ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0d1728] p-3 rounded-xl border border-[#1b2b48]">
        {/* Service Selector */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
            <span>🔌</span> Service:
          </span>
          <select
            value={currentService?.name || ""}
            onChange={(e) => {
              setSelectedServiceName(e.target.value);
              const found = availableServices.find((s) => s.name === e.target.value);
              if (found && onSelectService) onSelectService(found);
            }}
            className="rounded-lg bg-[#14223d] border border-blue-700/50 px-3 py-1.5 text-xs font-mono font-semibold text-sky-200 outline-none hover:border-blue-500 cursor-pointer transition-colors"
          >
            {availableServices.map((svc) => (
              <option key={svc.name} value={svc.name} className="bg-[#09111e] text-white">
                {svc.name} ({svc.type} • {svc.clusterIP})
              </option>
            ))}
          </select>
        </div>

        {/* Protocol Selector */}
        <div className="flex items-center space-x-1.5 bg-[#14223d] p-1 rounded-lg border border-slate-700/60">
          {(["HTTP", "TCP", "gRPC"] as const).map((proto) => (
            <button
              key={proto}
              onClick={() => setProtocol(proto)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-all ${
                protocol === proto
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {proto}
            </button>
          ))}
        </div>

        {/* Load Balancing Algorithm Selector */}
        <div className="flex items-center space-x-1.5 bg-[#14223d] p-1 rounded-lg border border-slate-700/60">
          <button
            onClick={() => {
              setLoadBalancingMode("round-robin");
              setPinnedPodIndex(null);
            }}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
              loadBalancingMode === "round-robin"
                ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Standard kube-proxy round-robin distribution"
          >
            Round-Robin
          </button>
          <button
            onClick={() => {
              setLoadBalancingMode("random");
              setPinnedPodIndex(null);
            }}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
              loadBalancingMode === "random"
                ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="iptables random probability weighting (1/n)"
          >
            Random DNAT
          </button>
        </div>

        {/* Speed & Actions */}
        <div className="flex items-center space-x-2">
          {/* Speed selector */}
          <div className="flex items-center bg-[#14223d] rounded-lg border border-slate-700/60 p-0.5 text-[10px] font-mono">
            {(["slow", "normal", "fast"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSimulationSpeed(s)}
                className={`px-2 py-1 rounded capitalize font-bold transition-all ${
                  simulationSpeed === s
                    ? "bg-slate-700 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Pause / Play Button */}
          <button
            onClick={() => setIsSimulating(!isSimulating)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md ${
              isSimulating
                ? "bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/50"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30"
            }`}
          >
            {isSimulating ? "⏸ Pause" : "▶ Play Stream"}
          </button>

          {/* Manual Burst Request Button */}
          <button
            onClick={sendPacket}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-lg shadow-blue-600/30 active:scale-95 flex items-center gap-1"
            title="Inject a single test packet immediately"
          >
            <span>⚡</span> Inject Request
          </button>
        </div>
      </div>

      {/* ================= MAIN SVG NETWORK VISUALIZER CANVAS ================= */}
      <div className="relative w-full overflow-hidden rounded-xl border border-[#1d2d4d] bg-gradient-to-b from-[#070e1a] to-[#0a1526] p-2 select-none shadow-inner">
        {/* SVG Mesh Layer */}
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto block"
          style={{ minHeight: "280px" }}
        >
          <defs>
            {/* Glow Filter for Beams & Packets */}
            <filter id="traffic-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Path Gradients */}
            <linearGradient id="client-to-vip-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
            </linearGradient>

            <linearGradient id="vip-to-proxy-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.9" />
            </linearGradient>

            <linearGradient id="proxy-to-pod-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.9" />
            </linearGradient>

            {/* Radial Packet Halo */}
            <radialGradient id="packet-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* --- BASE STATIC / ANIMATED PATH LINES --- */}

          {/* Segment 1: Client -> Service VIP */}
          <line
            x1={clientPoint.x}
            y1={clientPoint.y}
            x2={serviceVipPoint.x}
            y2={serviceVipPoint.y}
            stroke="#1e3a5f"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <line
            x1={clientPoint.x}
            y1={clientPoint.y}
            x2={serviceVipPoint.x}
            y2={serviceVipPoint.y}
            stroke="url(#client-to-vip-grad)"
            strokeWidth="2.5"
            strokeDasharray="6 6"
            className="animate-packet-flow"
            strokeLinecap="round"
          />

          {/* Segment 2: Service VIP -> kube-proxy */}
          <line
            x1={serviceVipPoint.x}
            y1={serviceVipPoint.y}
            x2={kubeProxyPoint.x}
            y2={kubeProxyPoint.y}
            stroke="#1e3a5f"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <line
            x1={serviceVipPoint.x}
            y1={serviceVipPoint.y}
            x2={kubeProxyPoint.x}
            y2={kubeProxyPoint.y}
            stroke="url(#vip-to-proxy-grad)"
            strokeWidth="2.5"
            strokeDasharray="6 6"
            className="animate-packet-flow"
            strokeLinecap="round"
          />

          {/* Segment 3: kube-proxy -> Each Pod Endpoint */}
          {endpointPositions.map((ep, idx) => {
            const curveD = getCurvePath(kubeProxyPoint, ep.point);
            const isLastHit = lastHitPodName === ep.pod.name;
            const isPinned = loadBalancingMode === "pinned" && pinnedPodIndex === idx;

            return (
              <g key={ep.pod.name || idx}>
                {/* Background Shadow Curve */}
                <path
                  d={curveD}
                  fill="none"
                  stroke="#162c4a"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                {/* Flowing Dash Beam */}
                <path
                  d={curveD}
                  fill="none"
                  stroke={isPinned ? "#22d3ee" : isLastHit ? "#34d399" : "url(#proxy-to-pod-grad)"}
                  strokeWidth={isPinned || isLastHit ? "3" : "2"}
                  strokeDasharray="6 6"
                  className={
                    simulationSpeed === "fast"
                      ? "animate-packet-flow-fast"
                      : simulationSpeed === "slow"
                      ? "animate-packet-flow-slow"
                      : "animate-packet-flow"
                  }
                  strokeLinecap="round"
                  filter={isLastHit ? "url(#traffic-glow)" : undefined}
                />
              </g>
            );
          })}

          {/* --- ACTIVE TRAVELING PACKETS --- */}
          {activePackets.map((pkt) => {
            const coord = getPacketCoordinates(pkt, renderTime);
            if (coord.progress >= 1) return null;

            return (
              <g key={pkt.id} transform={`translate(${coord.x}, ${coord.y})`}>
                {/* Outer Glowing Aura */}
                <circle
                  r="14"
                  fill="none"
                  stroke={pkt.color}
                  strokeWidth="1.5"
                  opacity={0.4}
                  className="animate-ping"
                />
                {/* Soft Halo */}
                <circle r="9" fill={pkt.color} opacity={0.3} filter="url(#traffic-glow)" />
                {/* Solid Core Packet */}
                <circle r="4.5" fill="#ffffff" stroke={pkt.color} strokeWidth="2" />
                {/* Mini Protocol Tag floating over packet */}
                <text
                  y="-11"
                  textAnchor="middle"
                  fill="#e2e8f0"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  className="select-none"
                >
                  {pkt.protocol}
                </text>
              </g>
            );
          })}

          {/* --- TOPOLOGY STAGE LABELS & ICONS --- */}

          {/* 1. Client / Ingress Node */}
          <g transform={`translate(${clientPoint.x}, ${clientPoint.y})`}>
            <circle
              r="26"
              fill="#0d1f38"
              stroke="#38bdf8"
              strokeWidth="2"
              filter="url(#traffic-glow)"
            />
            <text textAnchor="middle" y="5" fontSize="16">
              🌐
            </text>
            <text
              textAnchor="middle"
              y="40"
              fill="#93c5fd"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              External Client
            </text>
            <text
              textAnchor="middle"
              y="52"
              fill="#64748b"
              fontSize="8.5"
              fontFamily="monospace"
            >
              192.168.1.100
            </text>
          </g>

          {/* 2. Service VIP Node */}
          <g transform={`translate(${serviceVipPoint.x}, ${serviceVipPoint.y})`}>
            <circle
              r="30"
              fill="#0e2347"
              stroke="#3b82f6"
              strokeWidth="2.5"
              filter="url(#traffic-glow)"
            />
            <text textAnchor="middle" y="5" fontSize="17">
              🔌
            </text>
            <text
              textAnchor="middle"
              y="42"
              fill="#60a5fa"
              fontSize="10.5"
              fontWeight="bold"
              fontFamily="monospace"
            >
              {currentService?.name || "Service VIP"}
            </text>
            <text
              textAnchor="middle"
              y="54"
              fill="#38bdf8"
              fontSize="8.5"
              fontFamily="monospace"
            >
              VIP: {currentService?.clusterIP || "10.96.0.1"}
            </text>
            <text
              textAnchor="middle"
              y="66"
              fill="#64748b"
              fontSize="8"
              fontFamily="monospace"
            >
              Port: {formatPort(currentService?.ports)}
            </text>
          </g>

          {/* 3. kube-proxy & iptables DNAT Node */}
          <g transform={`translate(${kubeProxyPoint.x}, ${kubeProxyPoint.y})`}>
            <rect
              x="-42"
              y="-28"
              width="84"
              height="56"
              rx="12"
              fill="#181e3d"
              stroke="#818cf8"
              strokeWidth="2"
              filter="url(#traffic-glow)"
            />
            <text textAnchor="middle" y="-6" fontSize="13">
              ⚡ DNAT
            </text>
            <text
              textAnchor="middle"
              y="12"
              fill="#c7d2fe"
              fontSize="9.5"
              fontWeight="bold"
              fontFamily="monospace"
            >
              kube-proxy
            </text>
            <text
              textAnchor="middle"
              y="44"
              fill="#a5b4fc"
              fontSize="9.5"
              fontWeight="bold"
              fontFamily="monospace"
            >
              iptables / NAT
            </text>
            <text
              textAnchor="middle"
              y="56"
              fill="#64748b"
              fontSize="8"
              fontFamily="monospace"
            >
              DNAT VIP ➔ Pod IP
            </text>
          </g>

          {/* 4. Pod Endpoint Nodes on the Right */}
          {endpointPositions.map((ep, idx) => {
            const isHit = lastHitPodName === ep.pod.name;
            const isPinned = loadBalancingMode === "pinned" && pinnedPodIndex === idx;
            const hitCount = podHitStats[ep.pod.name] || 0;
            const percentage = totalPackets > 0 ? Math.round((hitCount / totalPackets) * 100) : 0;

            return (
              <g
                key={ep.pod.name || idx}
                transform={`translate(${ep.point.x}, ${ep.point.y})`}
                className="cursor-pointer"
                onClick={() => {
                  setLoadBalancingMode("pinned");
                  setPinnedPodIndex(idx);
                }}
              >
                {/* Hit Ripple Ring */}
                {isHit && (
                  <circle
                    r="34"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    className="animate-ping"
                  />
                )}

                {/* Pod Card Container */}
                <rect
                  x="-75"
                  y="-24"
                  width="150"
                  height="48"
                  rx="10"
                  fill={isHit ? "#0a2e24" : isPinned ? "#082c38" : "#0c1b2c"}
                  stroke={isHit ? "#10b981" : isPinned ? "#22d3ee" : "#243b5e"}
                  strokeWidth={isHit || isPinned ? "2" : "1.5"}
                  className="transition-all duration-300"
                />

                {/* Status Dot */}
                <circle
                  cx="-60"
                  cy="0"
                  r="4"
                  fill="#10b981"
                  className="animate-pulse"
                />

                {/* Pod Name */}
                <text
                  x="-50"
                  y="-7"
                  fill="#e2e8f0"
                  fontSize="9.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {ep.pod.name.length > 15 ? `${ep.pod.name.slice(0, 14)}…` : ep.pod.name}
                </text>

                {/* Pod IP & Node */}
                <text
                  x="-50"
                  y="6"
                  fill="#6ee7b7"
                  fontSize="8.5"
                  fontFamily="monospace"
                >
                  IP: {ep.pod.ip || "10.244.1.20"}
                </text>
                <text
                  x="-50"
                  y="16"
                  fill="#64748b"
                  fontSize="7.5"
                  fontFamily="monospace"
                >
                  {ep.pod.node || "worker-node-1"}
                </text>

                {/* Traffic Hits Badge */}
                <rect
                  x="30"
                  y="-14"
                  width="38"
                  height="28"
                  rx="6"
                  fill="#081424"
                  stroke="#1e3a5f"
                  strokeWidth="1"
                />
                <text
                  x="49"
                  y="-2"
                  textAnchor="middle"
                  fill="#38bdf8"
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {hitCount}
                </text>
                <text
                  x="49"
                  y="9"
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="7"
                  fontFamily="monospace"
                >
                  {percentage}%
                </text>
              </g>
            );
          })}
        </svg>

        {/* Informative Floating Architecture Legend */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#182844] pt-2 px-2 text-[10px] text-slate-400 font-mono">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> 1. Client Requests VIP
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-indigo-400" /> 2. kube-proxy rewrites Dest IP (DNAT)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> 3. Pod processes request
            </span>
          </div>

          <div className="text-slate-400 text-right">
            💡 <span className="text-slate-300">Click any Pod card on the right to pin traffic to it</span>
          </div>
        </div>
      </div>

      {/* ================= LIVE PACKET INSPECTOR STREAM ================= */}
      <div className="rounded-xl border border-[#1b2b48] bg-[#08101d] overflow-hidden">
        <div className="flex items-center justify-between bg-[#0e1b30] px-4 py-2 border-b border-[#1b2b48]">
          <div className="flex items-center space-x-2">
            <span className="text-xs">📋</span>
            <span className="text-xs font-bold text-slate-200">
              Live Kernel Packet & NAT Inspector Stream
            </span>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
              {packetLogs.length} frames logged
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setPacketLogs([])}
              className="text-[11px] font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Clear Log
            </button>
            <button
              onClick={() => setShowPacketInspector(!showPacketInspector)}
              className="text-xs text-slate-300 font-bold hover:text-white"
            >
              {showPacketInspector ? "▲ Hide" : "▼ Expand"}
            </button>
          </div>
        </div>

        {showPacketInspector && (
          <div className="max-h-44 overflow-y-auto p-3 font-mono text-[11px] space-y-1.5 thin-scroll bg-[#050b14]">
            {packetLogs.length === 0 ? (
              <div className="py-4 text-center text-slate-500 text-xs">
                No packet frames in buffer. Click &apos;Inject Request&apos; or start the live stream to inspect traffic!
              </div>
            ) : (
              packetLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#0b1626] px-3 py-1.5 border border-[#172742] hover:border-blue-500/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{log.timestamp}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        log.protocol === "HTTP"
                          ? "bg-sky-950 text-sky-300 border border-sky-800"
                          : log.protocol === "TCP"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : "bg-purple-950 text-purple-300 border border-purple-800"
                      }`}
                    >
                      {log.protocol}
                    </span>
                    <span className="text-slate-300 font-bold">{log.method}</span>
                    <span className="text-sky-400">{log.path}</span>
                    <span className="text-slate-500">➔ VIP {log.serviceVip}:{log.servicePort}</span>
                    <span className="text-indigo-400">➔ DNAT ➔</span>
                    <span className="text-emerald-400 font-bold">{log.podName} ({log.podIp})</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {log.natRule}
                    </span>
                    <span className="text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800 text-[10px]">
                      {log.statusCode} OK ({log.latencyMs}ms)
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ================= EDUCATIONAL INSIGHT DRAWER ================= */}
      <div className="rounded-xl border border-indigo-900/40 bg-gradient-to-r from-indigo-950/20 to-blue-950/20 p-3.5 text-xs text-indigo-200">
        <div className="flex items-start gap-2.5">
          <span className="text-base text-indigo-400 mt-0.5">💡</span>
          <div className="space-y-1">
            <div className="font-bold text-indigo-300">
              How Kubernetes Service Networking Works Under the Hood:
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              1. <strong>Virtual ClusterIPs:</strong> A Service VIP is not assigned to any physical network interface. It lives purely as kernel packet filter rules managed by <code className="text-indigo-300">kube-proxy</code>.
              <br />
              2. <strong>Transparent DNAT:</strong> When a client sends a packet to the ClusterIP, the Linux kernel intercepts the packet in the <code className="text-indigo-300">PREROUTING</code> chain and performs Destination NAT (DNAT), rewriting the destination IP to a live Pod IP chosen via iptables probability weights or IPVS hashing.
              <br />
              3. <strong>Zero Bottleneck:</strong> Because routing happens directly in the Linux kernel on each node, there is no centralized proxy bottleneck!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
