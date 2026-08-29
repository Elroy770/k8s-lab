import fs from "fs";
import path from "path";
import YAML from "yaml";
import { Lesson } from "./cluster-state";

// Fallback embedded lessons to guarantee the application works in any runtime environment
const DEFAULT_LESSONS: Lesson[] = [
  {
    id: "01-first-pod",
    title: "1. What is a Pod?",
    intro: "Pods are the smallest deployable units of computing in Kubernetes. A Pod encapsulates one or more containers sharing storage and network resources.\n\nYou can create Pods imperatively (`kubectl run`) or declaratively (`vim pod.yaml` + `kubectl apply -f pod.yaml`).\n\nLet's start by deploying a standalone Pod running the nginx image.",
    steps: [
      {
        type: "challenge",
        title: "Deploy Nginx Pod",
        prompt: "Run an nginx Pod named 'web'. You can use imperative `kubectl run` or apply declarative YAML (`kubectl apply -f pod.yaml` / `vim pod.yaml`).",
        hint: "kubectl run web --image=nginx (or: kubectl apply -f pod.yaml)",
        expected: {
          verb: "run",
          resource: "pod",
          name: "web",
        },
      },
      {
        type: "observation",
        title: "Observe Scheduled Pod",
        text: "The Pod 'web' is now running on a worker node. Notice how it appears in the live Data Plane view with an assigned node and virtual IP.",
      },
      {
        type: "challenge",
        title: "Inspect Pod Placement",
        prompt: "Inspect the running pod and discover its worker node assignment using `-o wide`.",
        hint: "kubectl get pods -o wide (or: kubectl get pods)",
        expected: {
          verb: "get",
          resource: "pod",
        },
      },
      {
        type: "transition",
        title: "Next: Pod Failures",
        text: "Great job! Now let's see what happens when a standalone Pod experiences a node failure or is deleted.",
      },
    ],
  },
  {
    id: "02-pod-lifecycle",
    title: "2. Your Pod Died",
    intro: "Your standalone nginx Pod 'web' is currently running on worker-node-1.\n\nLet's simulate a crash or an accidental deletion to observe the default lifecycle of a standalone Pod.",
    initialState: {
      pods: [
        {
          name: "web",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.1.15",
          restarts: 0,
          age: "2m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        title: "Delete Standalone Pod",
        prompt: "Delete the 'web' Pod to observe if it recovers.",
        hint: "kubectl delete pod web",
        expected: {
          verb: "delete",
          resource: "pod",
          name: "web",
        },
      },
      {
        type: "observation",
        title: "Pod Disappeared",
        text: "The Pod disappeared from the cluster and did not come back!",
      },
      {
        type: "explanation",
        title: "Why Standalone Pods Don't Self-Heal",
        text: "A standalone Pod has NO controller responsible for monitoring or restoring it. If the worker node dies or the Pod crashes, it stays gone forever.",
      },
      {
        type: "transition",
        title: "Next: The ReplicaSet Controller",
        text: "In production, we need self-healing. This brings us to the ReplicaSet controller.",
      },
    ],
  },
  {
    id: "03-replicaset",
    title: "3. The ReplicaSet & Self-Healing",
    intro: "A ReplicaSet is a controller whose sole job is to maintain a stable set of replica Pods running across worker nodes at any given time.\n\nIt continuously runs a Reconciliation Loop: comparing the Desired State with the Actual State.\n\nWe have created a ReplicaSet named 'frontend' with 3 desired replicas for you.",
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
          ip: "10.244.1.21",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
        {
          name: "frontend-d3e4f",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-2",
          ip: "10.244.2.22",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
        {
          name: "frontend-g5h6j",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.1.23",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "frontend" },
          age: "5m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        title: "Simulate Pod Failure",
        prompt: "Delete any one of the ReplicaSet's Pods (e.g. 'frontend-a1b2c').",
        hint: "kubectl delete pod frontend-a1b2c",
        expected: {
          verb: "delete",
          resource: "pod",
        },
      },
      {
        type: "observation",
        title: "Instant Self-Healing",
        text: "Watch the cluster view! As soon as the Pod died, the ReplicaSet controller noticed Actual Replicas (2) < Desired Replicas (3) and immediately created a brand new replacement Pod on an available worker node!",
      },
      {
        type: "explanation",
        title: "The Reconciliation Loop",
        text: "This is Kubernetes Self-Healing in action. The controller constantly reconciles actual state back to desired state.",
      },
      {
        type: "challenge",
        title: "Scale ReplicaSet",
        prompt: "Scale the 'frontend' ReplicaSet to 5 replicas via imperative `kubectl scale` or by editing `replicaset.yaml`.",
        hint: "kubectl scale rs frontend --replicas=5 (or: kubectl apply -f replicaset.yaml)",
        expected: {
          verb: "scale",
          resource: "replicaset",
          name: "frontend",
        },
      },
      {
        type: "observation",
        title: "Scale-Out Verified",
        text: "The ReplicaSet immediately created 2 more Pods distributed across worker nodes to reach the new desired count of 5!",
      },
      {
        type: "transition",
        title: "Next: Deployments",
        text: "ReplicaSets maintain pod counts, but what happens when you need to update application code or deploy a new image version without downtime? That's where Deployments come in.",
      },
    ],
  },
  {
    id: "04-deployment",
    title: "4. Deployments & Rolling Updates",
    intro: "A Deployment is a higher-level abstraction that manages ReplicaSets. It provides declarative updates (`vim deployment.yaml` + `kubectl apply -f deployment.yaml`), rolling upgrades, revision history, and zero-downtime rollbacks.\n\nWe have deployed 'my-app' with 3 replicas across worker nodes.",
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
          ip: "10.244.1.31",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
        {
          name: "my-app-v1-x2",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-2",
          ip: "10.244.2.32",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
        {
          name: "my-app-v1-x3",
          image: "nginx:latest",
          status: "Running",
          node: "worker-node-1",
          ip: "10.244.1.33",
          restarts: 0,
          ownerRef: { kind: "ReplicaSet", name: "my-app-v1" },
          age: "10m",
        },
      ],
    },
    steps: [
      {
        type: "challenge",
        title: "Update Deployment Image",
        prompt: "Update the image of 'my-app' to 'nginx:1.19' using `kubectl set image` or by editing `deployment.yaml` in Vim and applying it.",
        hint: "kubectl set image deployment/my-app nginx=nginx:1.19 (or: kubectl apply -f deployment.yaml)",
        expected: {
          verb: "set",
          resource: "deployment",
          name: "my-app",
        },
      },
      {
        type: "observation",
        title: "Rolling Update in Motion",
        text: "The Deployment created a new ReplicaSet ('my-app-v2') for the new image version, scaled it up, and gradually scaled down the old ReplicaSet ('my-app-v1')!",
      },
      {
        type: "explanation",
        title: "Zero-Downtime Rollout",
        text: "This is a Rolling Update. At no point was your application completely down during the transition.",
      },
      {
        type: "challenge",
        title: "Rollback Buggy Version",
        prompt: "Suppose the new version has an issue. Roll back to the previous revision!",
        hint: "kubectl rollout undo deployment/my-app",
        expected: {
          verb: "rollout",
          resource: "deployment",
          name: "my-app",
        },
      },
      {
        type: "observation",
        title: "Restoration Complete",
        text: "The Deployment instantly rolled back by scaling the old stable ReplicaSet back up and scaling down the broken one!",
      },
      {
        type: "transition",
        title: "Mastery Achieved",
        text: "Congratulations! You've mastered the core relationship: Deployment -> ReplicaSet -> Pods across worker nodes.",
      },
    ],
  },
];

function normalizeLesson(data: Lesson): Lesson {
  if (!data.initialState) return data;

  const state = data.initialState;
  return {
    ...data,
    initialState: {
      ...state,
      replicaSets: (state.replicaSets || []).map((raw) => {
        const rs = raw as typeof raw & { replicas?: number };
        const replicas = rs.desiredReplicas ?? rs.replicas ?? 0;
        return {
          ...rs,
          desiredReplicas: replicas,
          currentReplicas: rs.currentReplicas ?? replicas,
          readyReplicas: rs.readyReplicas ?? replicas,
          image: rs.image || "nginx:latest",
          age: rs.age || "now",
        };
      }),
      pods: (state.pods || []).map((raw, idx) => {
        const pod = raw as typeof raw & { owner?: string };
        const defaultNode = idx % 2 === 0 ? "worker-node-1" : "worker-node-2";
        const defaultIp = `10.244.${(idx % 2) + 1}.${10 + idx}`;
        return {
          ...pod,
          image: pod.image || "nginx:latest",
          status: pod.status || "Running",
          node: pod.node || defaultNode,
          ip: pod.ip || defaultIp,
          restarts: pod.restarts ?? 0,
          age: pod.age || "now",
          ownerRef: pod.ownerRef || (pod.owner ? { kind: "ReplicaSet", name: pod.owner } : undefined),
        };
      }),
    },
  };
}

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
              loaded.push(normalizeLesson(data));
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
