/**
 * Lesson order. Add a file to /lessons and list it here; nothing in the UI
 * needs to change.
 */
export const lessonManifest = [
  // Workloads
  "01-first-pod",
  "02-inspect-pod",
  "03-pod-is-mortal",
  "04-replicaset",
  "05-self-healing",
  "06-scaling",
  "07-deployment",
  "08-rolling-update",
  "09-rollout-history",
  "10-broken-update",
  "11-rollback",
  "12-mental-model",
  // Configuration
  "13-configmaps",
  "14-secrets",
  "15-declarative-yaml",
  // Workload types
  "16-daemonset",
  "17-statefulset",
  "18-statefulset-storage",
  "19-workload-comparison",
  // Services
  "20-why-services",
  "21-clusterip",
  "22-service-selectors",
  "23-nodeport",
  "24-service-types",
  // Ingress
  "25-ingress-basics",
  "26-ingress-host-routing",
  "27-ingress-path-routing",
  "28-ingress-troubleshooting",
  // Storage
  "29-ephemeral-storage",
  "30-emptydir",
  "31-pv-pvc",
  "32-storageclass",
  "33-access-modes",
  "34-storage-troubleshooting",
  // Scheduling
  "35-nodeselector",
  "36-node-affinity",
  "37-taints-tolerations",
  // Health
  "38-liveness",
  "39-readiness",
  "40-startup-probes",
  // Jobs
  "41-jobs",
  "42-cronjobs",
  // Observability
  "43-events-describe",
  "44-logs",
  "45-exec",
  // Capstones
  "46-capstone-web-app",
  "47-capstone-stateful-app",
  "48-capstone-daemonset-app",
  "49-broken-cluster",
  "50-final-architecture",
] as const;
