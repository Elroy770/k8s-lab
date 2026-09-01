"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClusterView from "@/components/ClusterView";
import LessonMenu from "@/components/LessonMenu";
import StoryPanel from "@/components/StoryPanel";
import Terminal, { type TerminalLine } from "@/components/Terminal";
import { clone, isSettled, tick } from "@/engine/cluster-state";
import { matchesExpectation, parseCommand } from "@/engine/kubectl-parser";
import { applyEffect, buildInitialCluster } from "@/engine/lesson-runtime";
import type { Lesson } from "@/engine/lesson-types";
import { execute } from "@/engine/simulator";
import type { ClusterState } from "@/engine/types";

const TICK_MS = 700;

const HELP = [
  "Inspect:",
  "  kubectl get pods|rs|deploy|ds|sts|jobs|cronjobs|svc|endpoints|ingress",
  "  kubectl get cm|secrets|pv|pvc|sc|nodes|events|all   [-o wide] [--show-labels] [-l k=v]",
  "  kubectl describe <resource> NAME",
  "  kubectl logs POD",
  "",
  "Create and change:",
  "  kubectl run NAME --image=IMAGE",
  "  kubectl create deployment NAME --image=IMAGE --replicas=N",
  "  kubectl create configmap NAME --from-literal=k=v",
  "  kubectl create secret generic NAME --from-literal=k=v",
  "  kubectl apply -f FILE.yaml",
  "  kubectl expose deployment NAME --port=80 [--type=NodePort] [--name=NAME]",
  "  kubectl scale deploy|sts|rs NAME --replicas=N",
  "  kubectl set image deployment/NAME app=IMAGE",
  "  kubectl rollout status|history|undo|restart deployment/NAME",
  "  kubectl label node NAME key=value   (key- to remove)",
  "  kubectl taint nodes NAME key=value:NoSchedule   (trailing - to remove)",
  "  kubectl delete <resource> NAME",
  "",
  "Inside a Pod:",
  "  kubectl exec POD -- hostname | env | ls PATH | cat FILE | nslookup SVC | curl URL",
  "  kubectl exec POD -- sh -c \"echo text > /path/file\"",
  "",
  "From the lab shell:",
  "  curl http://SERVICE | http://HOST/PATH | http://NODE:NODEPORT",
  "  cat FILE.yaml, help, clear",
];

export default function Lab({ lessons }: { lessons: Lesson[] }) {
  const [lessonIndex, setLessonIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [reveals, setReveals] = useState<Record<number, string>>({});
  const [cluster, setCluster] = useState<ClusterState>(() =>
    buildInitialCluster(lessons[0]?.initialState),
  );
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const lineId = useRef(0);
  const appliedEffects = useRef(new Set<string>());

  const lesson = lessons[lessonIndex];
  const finished = stepIndex >= lesson.steps.length;
  const currentStep = finished ? undefined : lesson.steps[stepIndex];

  const push = useCallback((entries: Omit<TerminalLine, "id">[]) => {
    setLines((previous) => [
      ...previous,
      ...entries.map((entry) => ({ ...entry, id: lineId.current++ })),
    ]);
  }, []);

  const startLesson = useCallback(
    (index: number) => {
      const next = lessons[index];
      setLessonIndex(index);
      setStepIndex(0);
      setReveals({});
      setMenuOpen(false);
      setCluster(buildInitialCluster(next.initialState));
      appliedEffects.current = new Set();
      lineId.current = 0;
      setLines([
        {
          id: lineId.current++,
          kind: "system",
          text: `— lesson ${index + 1}/${lessons.length}: ${next.title} — type "help" for the command list`,
        },
      ]);
    },
    [lessons],
  );

  useEffect(() => {
    startLesson(0);
  }, [startLesson]);

  // The control loops keep running between commands, so scheduling, rollouts
  // and cron schedules are things the learner watches rather than reads about.
  useEffect(() => {
    const timer = setInterval(() => {
      setCluster((previous) => {
        if (isSettled(previous)) return previous;
        const next = clone(previous);
        tick(next);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // A step can carry a scripted world event, such as a node joining.
  useEffect(() => {
    const step = lesson.steps[stepIndex];
    const key = `${lesson.id}#${stepIndex}`;
    if (!step?.effect || appliedEffects.current.has(key)) return;
    appliedEffects.current.add(key);
    setCluster((previous) => {
      const next = clone(previous);
      const messages = applyEffect(next, step.effect!);
      if (messages.length) {
        push(messages.map((text) => ({ kind: "system" as const, text: `* ${text}` })));
      }
      return next;
    });
  }, [lesson, stepIndex, push]);

  const advance = useCallback(
    (reveal?: string) => {
      setReveals((previous) => (reveal ? { ...previous, [stepIndex]: reveal } : previous));
      setStepIndex((previous) => previous + 1);
    },
    [stepIndex],
  );

  const handleCommand = useCallback(
    (raw: string) => {
      push([{ kind: "command", text: raw }]);
      const trimmed = raw.trim();

      if (trimmed === "clear") {
        setLines([]);
        return;
      }
      if (trimmed === "help") {
        push(HELP.map((text) => ({ kind: "output" as const, text })));
        return;
      }

      const parsed = parseCommand(raw);
      const next = clone(cluster);
      const result = execute(next, parsed, { files: lesson.files ?? {} });
      setCluster(next);
      push(
        result.output.map((text) => ({
          kind: result.isError ? ("error" as const) : ("output" as const),
          text,
        })),
      );

      const satisfied =
        currentStep?.type === "challenge" &&
        currentStep.expected &&
        matchesExpectation(parsed, currentStep.expected) &&
        (!result.isError || currentStep.allowError === true);

      if (satisfied) {
        push([{ kind: "success", text: `✓ ${currentStep.reveal ?? "mission complete"}` }]);
        advance(currentStep.reveal);
      }
    },
    [advance, cluster, currentStep, lesson.files, push],
  );

  const suggestion = useMemo(
    () => (currentStep?.type === "challenge" ? currentStep.hint : undefined),
    [currentStep],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="relative flex shrink-0 items-center gap-4 border-b border-line bg-panel px-5 py-3">
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            Kubernetes Story Lab
          </h1>
          <p className="text-[11px] text-slate-500">
            A simulated cluster. Every command is fake, every consequence is real.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => startLesson(Math.max(0, lessonIndex - 1))}
            disabled={lessonIndex === 0}
            className="rounded border border-line px-2 py-1 text-[12px] text-slate-400 hover:text-slate-100 disabled:opacity-30"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded border border-line px-3 py-1 text-[12px] text-slate-300 hover:border-accent/60 hover:text-slate-100"
          >
            {lesson.chapter} · {lessonIndex + 1}/{lessons.length} ▾
          </button>
          <button
            type="button"
            onClick={() => startLesson(Math.min(lessons.length - 1, lessonIndex + 1))}
            disabled={lessonIndex === lessons.length - 1}
            className="rounded border border-line px-2 py-1 text-[12px] text-slate-400 hover:text-slate-100 disabled:opacity-30"
          >
            →
          </button>
        </div>

        {menuOpen ? (
          <LessonMenu
            lessons={lessons}
            currentIndex={lessonIndex}
            onSelect={startLesson}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}
      </header>

      <main className="bright-panes flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="bg-surface flex min-h-0 flex-col border-line md:w-[42%] md:border-r">
          <StoryPanel
            lesson={lesson}
            lessonNumber={lessonIndex + 1}
            lessonCount={lessons.length}
            stepIndex={stepIndex}
            reveals={reveals}
            finished={finished}
            hasNextLesson={lessonIndex + 1 < lessons.length}
            onContinue={() => advance(currentStep?.reveal)}
            onNextLesson={() => startLesson(lessonIndex + 1)}
            onRestartLesson={() => startLesson(lessonIndex)}
          />
        </section>

        <section className="bg-surface flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2">
            <h2 className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Live cluster
            </h2>
            <span className="mono text-[11px] text-slate-600">
              {cluster.pods.length} pods · {cluster.services.length} services ·{" "}
              {cluster.nodes.length} nodes
            </span>
          </div>
          <ClusterView state={cluster} files={lesson.files} />
        </section>
      </main>

      <div className="h-[34vh] min-h-[220px] shrink-0">
        <Terminal lines={lines} onSubmit={handleCommand} suggestion={suggestion} />
      </div>
    </div>
  );
}
