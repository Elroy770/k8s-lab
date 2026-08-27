import fs from "fs";
import path from "path";
import YAML from "yaml";
import { Lesson } from "./cluster-state";

// Fallback embedded lessons to guarantee the application works in any runtime environment
const DEFAULT_LESSONS: Lesson[] = [
  {
    id: "01-first-pod",
    title: "1. What is a Pod?",
    intro: "Pods are the smallest deployable units of computing in Kubernetes. A Pod encapsulates one or more containers sharing storage and network resources.\n\nLet's start by creating a standalone Pod running the nginx image.",
    steps: [
      {
        type: "challenge",
        prompt: "Run an nginx Pod named 'web'.\n(Hint: kubectl run web --image=nginx)",
        hint: "kubectl run web --image=nginx",
        expected: {
          verb: "run",
          resource: "pod",
          name: "web",
        },
      },
      {
        type: "observation",
        text: "The Pod 'web' is now running on a worker node. Notice how it appears in the live cluster view with an assigned IP and running status.",
      },
      {
        type: "challenge",
        prompt: "Inspect the running pod by getting pods list.\n(Hint: kubectl get pods)",
        hint: "kubectl get pods",
        expected: {
          verb: "get",
          resource: "pod",
        },
      },
      {
        type: "transition",
        text: "Great job! Now let's see what happens when a standalone Pod experiences a failure or is deleted.",
      },
    ],
  },
  {
    id: "02-pod-lifecycle",
    title: "2. Your Pod Died",
    intro: "Your standalone nginx Pod 'web' is currently running.\n\nLet's simulate a crash or an accidental deletion to observe the default lifecycle of a standalone Pod.",
    initialState: {
      pods: [
        {
          name: "web",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.15",
          restarts: 0,
          age: "2m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        prompt: "Delete the 'web' Pod.\n(Hint: kubectl delete pod web)",
        hint: "kubectl delete pod web",
        expected: {
          verb: "delete",
          resource: "pod",
          name: "web",
        },
      },
      {
        type: "observation",
        text: "The Pod disappeared from the cluster and did not come back!",
      },
      {
        type: "explanation",
        text: "A standalone Pod has NO controller responsible for monitoring or restoring it. If the node dies or the Pod crashes, it stays gone forever.",
      },
      {
        type: "transition",
        text: "In production, we need self-healing. This brings us to the ReplicaSet controller.",
      },
    ],
  },
  {
    id: "03-replicaset",
    title: "3. The ReplicaSet & Self-Healing",
    intro: "A ReplicaSet is a controller whose sole job is to maintain a stable set of replica Pods running at any given time.\n\nIt continuously runs a Reconciliation Loop: comparing the Desired State with the Actual State.\n\nWe have created a ReplicaSet named 'frontend' with 3 desired replicas for you.",
    initialState: {
      replicaSets: [
        {
          name: "frontend",
          desiredReplicas: 3,
          currentReplicas: 3,
          readyReplicas: 3,
          image: "nginx:latest",
          age: "5m",
        },
      ],
      pods: [
        {
          name: "frontend-a1b2c",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.21",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
        {
          name: "frontend-d3e4f",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.22",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
        {
          name: "frontend-g5h6j",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.23",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        prompt: "Delete any one of the ReplicaSet's Pods (e.g. 'frontend-a1b2c').\n(Hint: kubectl delete pod frontend-a1b2c)",
        hint: "kubectl delete pod frontend-a1b2c",
        expected: {
          verb: "delete",
          resource: "pod",
        },
      },
      {
        type: "observation",
        text: "Watch the cluster view! As soon as the Pod died, the ReplicaSet controller noticed Actual Replicas (2) < Desired Replicas (3) and immediately created a brand new replacement Pod!",
      },
      {
        type: "explanation",
        text: "This is Kubernetes Self-Healing in action. The controller constantly reconciles actual state back to desired state.",
      },
      {
        type: "challenge",
        prompt: "Scale the 'frontend' ReplicaSet to 5 replicas.\n(Hint: kubectl scale rs frontend --replicas=5)",
        hint: "kubectl scale rs frontend --replicas=5",
        expected: {
          verb: "scale",
          resource: "replicaset",
          name: "frontend",
        },
      },
      {
        type: "observation",
        text: "The ReplicaSet immediately created 2 more Pods to reach the new desired count of 5!",
      },
      {
        type: "transition",
        text: "ReplicaSets maintain pod counts, but what happens when you need to update application code or deploy a new image version without downtime? That's where Deployments come in.",
      },
    ],
  },
  {
    id: "04-deployment",
    title: "4. Deployments & Rolling Updates",
    intro: "A Deployment is a higher-level abstraction that manages ReplicaSets. It provides declarative updates, rolling upgrades, revision history, and zero-downtime rollbacks.\n\nWe have deployed 'my-app' with 3 replicas.",
    initialState: {
      deployments: [
        {
          name: "my-app",
          replicas: 3,
          upToDate: 3,
          available: 3,
          image: "nginx:latest",
          revision: 1,
          age: "10m",
        },
      ],
      replicaSets: [
        {
          name: "my-app-v1",
          desiredReplicas: 3,
          currentReplicas: 3,
          readyReplicas: 3,
          image: "nginx:latest",
          ownerRef: { kind: "Deployment", name: "my-app" },
          age: "10m",
        },
      ],
      pods: [
        {
          name: "my-app-v1-x1",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.31",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
        {
          name: "my-app-v1-x2",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.32",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
        {
          name: "my-app-v1-x3",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.0.33",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        prompt: "Update the image of 'my-app' to 'nginx:1.19'.\n(Hint: kubectl set image deployment/my-app nginx=nginx:1.19)",
        hint: "kubectl set image deployment/my-app nginx=nginx:1.19",
        expected: {
          verb: "set",
          resource: "deployment",
          name: "my-app",
        },
      },
      {
        type: "observation",
        text: "The Deployment created a new ReplicaSet ('my-app-v2') for the new image version, scaled it up, and scaled down the old ReplicaSet ('my-app-v1')!",
      },
      {
        type: "explanation",
        text: "This is a Rolling Update. At no point was your application completely down during the transition.",
      },
      {
        type: "challenge",
        prompt: "Suppose the new version has an issue. Roll back to the previous revision!\n(Hint: kubectl rollout undo deployment/my-app)",
        hint: "kubectl rollout undo deployment/my-app",
        expected: {
          verb: "rollout",
          resource: "deployment",
          name: "my-app",
        },
      },
      {
        type: "observation",
        text: "The Deployment instantly rolled back by scaling the old stable ReplicaSet back up and scaling down the broken one!",
      },
      {
        type: "transition",
        text: "Congratulations! You've mastered the core relationship: Deployment -> ReplicaSet -> Pods.",
      },
    ],
  },
];

export async function loadLessons(): Promise<Lesson[]> {
  const possiblePaths = [
    path.join(process.cwd(), "lessons"),
    "/app/lessons",
    "/lessons",
  ];

  for (const dir of possiblePaths) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ dir)) {
        const files = fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
        if (files.length > 0) {
          files.sort();
          const loaded: Lesson[] = [];
          for (const file of files) {
            const filePath = path.join(/*turbopackIgnore: true*/ dir, file);
            const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8");
            const data = (typeof YAML?.parse === "function" ? YAML.parse(raw) : (YAML as any)(raw)) as Lesson;
            if (data && data.title && data.steps) {
              loaded.push(data);
            }
          }
          if (loaded.length > 0) {
            return loaded;
          }
        }
      }
    } catch {
      // Continue to next directory or fallback
    }
  }

  return DEFAULT_LESSONS;
}
