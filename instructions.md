# Instructions for Building the Kubernetes Story Lab

## Goal

Build a small interactive web application that teaches Kubernetes core concepts as a story-driven lab.

The educational source of truth is:

`cka1-core-concepts.md`

This file is located in the same project directory.

The application must transform the concepts in that file into a sequence of interactive lessons where the learner is asked to run `kubectl` commands and then observes the effect on a simulated Kubernetes cluster.

Do **not** build a static course or documentation site.

The desired experience is:

**Story → Task → User command → Simulated cluster change → Visual consequence → Explanation → Next task**

Example journey:

`Pod → delete Pod → Pod stays dead → ReplicaSet → delete Pod → Pod is recreated → Deployment → update image → new ReplicaSet → rolling update → rollback`

---

## Important Architecture Decision

Lessons must **not** be hard-coded inside React/UI components.

The application should load lessons from structured lesson files.

Recommended structure:

```text
/
├── instructions.md
├── cka1-core-concepts.md
├── app/
├── components/
├── engine/
│   ├── kubectl-parser.ts
│   ├── cluster-state.ts
│   └── simulator.ts
└── lessons/
    ├── 01-first-pod.yaml
    ├── 02-pod-lifecycle.yaml
    ├── 03-replicaset.yaml
    ├── 04-scaling.yaml
    ├── 05-deployment.yaml
    ├── 06-rolling-update.yaml
    └── 07-rollback.yaml
```

At application startup, load the lesson definitions from `/lessons`.

The UI should know nothing about specific lessons. It should render whatever lesson data it receives.

---

## Recommended Tech Stack

Keep the MVP simple:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Client-side state only
- No real Kubernetes cluster
- No Docker, Minikube, Kind, or backend for v1

The Kubernetes environment should be simulated deterministically in the browser.

---

## Divide the Work Conceptually Into Agents

Treat the project as if several specialized agents are collaborating.

### Agent 1 — Curriculum Architect

Responsibilities:

1. Read `cka1-core-concepts.md`.
2. Extract the important learning objectives.
3. Turn them into a progressive lesson sequence.
4. Prefer cause-and-effect scenarios over definitions.
5. Produce lesson files inside `/lessons`.

Do not simply convert headings from the source file into lessons.

Prefer:

> Delete this Pod and observe what happens.

Instead of:

> A ReplicaSet maintains a desired number of Pods.

Every lesson should introduce a problem that naturally motivates the next Kubernetes concept.

---

### Agent 2 — Lesson Author

Create structured lesson definitions.

A lesson should contain fields similar to:

```yaml
id: pod-lifecycle
title: Your Pod Died

intro: |
  Your nginx Pod is currently running.
  Let's see what happens when it disappears.

steps:
  - type: challenge
    prompt: Delete the nginx Pod.
    expected:
      verb: delete
      resource: pod
      name: nginx

  - type: observation
    text: |
      The Pod disappeared and did not come back.

  - type: explanation
    text: |
      A standalone Pod has no controller responsible
      for restoring it.

  - type: transition
    text: |
      We need something that continuously maintains
      our desired state.
```

Lesson files should describe learning flow, not UI implementation.

---

### Agent 3 — Kubernetes Simulation Engineer

Build a small deterministic Kubernetes simulator.

Maintain state such as:

```ts
interface ClusterState {
  pods: Pod[];
  replicaSets: ReplicaSet[];
  deployments: Deployment[];
}
```

Support only the commands required by the lessons.

Initial command set may include:

```text
kubectl run
kubectl get pods
kubectl describe pod
kubectl delete pod

kubectl get rs
kubectl scale rs

kubectl create deployment
kubectl get deployments
kubectl get rs

kubectl scale deployment
kubectl set image
kubectl rollout status
kubectl rollout history
kubectl rollout undo
```

Do not attempt to implement all of Kubernetes or all of `kubectl`.

Simulate Kubernetes reconciliation behavior where educationally useful.

Example:

```text
ReplicaSet desired replicas = 3
Actual Pods = 2

→ controller detects mismatch
→ new Pod is created
→ Actual Pods = 3
```

---

### Agent 4 — Command Parser Engineer

Do not validate commands using exact string matching.

Parse commands into semantic actions.

For example:

```text
kubectl get pods
kubectl get pod
kubectl get po
```

should all resolve to something similar to:

```ts
{
  verb: "get",
  resource: "pods"
}
```

Lesson validation should check intent rather than exact text.

---

### Agent 5 — UI / Experience Engineer

Build one main lab screen with three areas:

```text
┌──────────────────────────────────────────────┐
│ Lesson / Story        │ Live Cluster         │
│                       │                      │
│ Explanation           │ Deployment           │
│ Current mission       │   ↓                  │
│ Hint                  │ ReplicaSet           │
│                       │   ↓                  │
│                       │ Pods                 │
├──────────────────────────────────────────────┤
│ Terminal                                     │
│ $ kubectl ...                                │
└──────────────────────────────────────────────┘
```

The learner should always see:

- current story/context
- current task
- optional hint
- live cluster state
- simulated terminal
- lesson progress

The cluster visualization should make ownership relationships obvious:

```text
Deployment
   ↓
ReplicaSet
   ↓
Pods
```

For rolling updates, visually show both the old and new ReplicaSets.

---

## Core Educational Principles

The lab should teach Kubernetes through discovery.

Use this pattern repeatedly:

```text
Context
↓
Challenge
↓
User action
↓
Visible consequence
↓
Question / surprise
↓
Explanation
↓
Next challenge
```

Example:

1. Learner creates a Pod.
2. Learner deletes the Pod.
3. Pod does not return.
4. Explain why.
5. Introduce ReplicaSet.
6. Learner deletes a ReplicaSet-managed Pod.
7. Simulator recreates it.
8. Learner sees desired state vs actual state.

Avoid long explanations before the learner has observed the behavior.

---

## Desired First Learning Path

Generate the actual lessons from `cka1-core-concepts.md`, but the first vertical slice should roughly cover:

1. What is a Pod?
2. Create the first Pod.
3. Inspect a Pod.
4. Delete the Pod.
5. Observe that it does not return.
6. Introduce ReplicaSet.
7. Create/manage multiple replicas.
8. Delete one managed Pod.
9. Observe reconciliation.
10. Scale replicas.
11. Introduce Deployment.
12. Understand Deployment → ReplicaSet → Pod ownership.
13. Update the Deployment image.
14. Observe a new ReplicaSet.
15. Observe a rolling update.
16. Inspect rollout status/history.
17. Simulate a broken update if supported by the source material.
18. Roll back.
19. End with a visual mental model of the resources.

Do not force topics that are not supported by `cka1-core-concepts.md`.

---

## Lesson Loading

Implement a lesson loader.

The loader should:

1. Discover lesson definitions from `/lessons`.
2. Validate their structure.
3. Sort them by lesson order.
4. Pass them to the lesson engine.
5. Allow new lessons to be added without changing UI code.

A lesson index/manifest is acceptable if automatic filesystem discovery is inconvenient.

For example:

```ts
export const lessonManifest = [
  "01-first-pod",
  "02-pod-lifecycle",
  "03-replicaset",
  "04-deployment"
];
```

The important requirement is that lesson **content and logic remain external to the UI**.

---

## MVP Rules

For the first version:

- Use a fake Kubernetes cluster.
- Keep all state local.
- Support only commands used by lessons.
- Do not require authentication.
- Do not require a backend.
- Do not require a real terminal.
- Do not use real Kubernetes.
- Do not over-engineer the UI.
- Prioritize the learning flow.

The first milestone is one complete working story:

```text
Pod
→ failure
→ ReplicaSet
→ reconciliation
→ Deployment
→ rolling update
→ rollback
```

Only after this vertical slice works well should additional CKA topics be added.

---

## Definition of Done

The project is successful when a learner can open the application with no Kubernetes cluster installed and complete a guided interactive story where they:

1. type realistic `kubectl` commands,
2. receive realistic simulated output,
3. see the cluster state change visually,
4. understand why ReplicaSets and Deployments exist,
5. understand what happens during a Deployment update,
6. progress through lessons generated from `cka1-core-concepts.md`.

The final application should feel like a small interactive Kubernetes sandbox, not like a slide deck or documentation page.
