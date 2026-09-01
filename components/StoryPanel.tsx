"use client";

import { useEffect, useRef, useState } from "react";
import Prose from "@/components/Prose";
import type { Lesson, LessonStep } from "@/engine/lesson-types";

const TYPE_LABEL: Record<LessonStep["type"], string> = {
  observation: "Observe",
  challenge: "Your mission",
  explanation: "Why",
  transition: "Next",
};

function StepBody({ step }: { step: LessonStep }) {
  return <Prose className="mt-1.5" text={step.type === "challenge" ? (step.prompt ?? "") : (step.text ?? "")} />;
}

interface StoryPanelProps {
  lesson: Lesson;
  lessonNumber: number;
  lessonCount: number;
  stepIndex: number;
  reveals: Record<number, string>;
  finished: boolean;
  hasNextLesson: boolean;
  onContinue: () => void;
  onNextLesson: () => void;
  onRestartLesson: () => void;
}

export default function StoryPanel({
  lesson,
  lessonNumber,
  lessonCount,
  stepIndex,
  reveals,
  finished,
  hasNextLesson,
  onContinue,
  onNextLesson,
  onRestartLesson,
}: StoryPanelProps) {
  const [hintVisible, setHintVisible] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHintVisible(false);
  }, [stepIndex, lesson.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stepIndex, finished, lesson.id]);

  const current = finished ? undefined : lesson.steps[stepIndex];
  const done = lesson.steps.slice(0, stepIndex);

  return (
    <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <header>
        <div className="flex items-center gap-2 text-[11px] tracking-wide text-slate-500 uppercase">
          <span>
            Lesson {lessonNumber} of {lessonCount}
          </span>
          {lesson.concept ? (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent normal-case">
              {lesson.concept}
            </span>
          ) : null}
        </div>
        <h1 className="mt-1.5 text-xl font-semibold text-slate-50">{lesson.title}</h1>
        <Prose className="mt-2 opacity-80" text={lesson.intro} />
      </header>

      <ol className="mt-5 flex flex-col gap-3">
        {done.map((step, index) => (
          <li
            key={index}
            className="rounded-lg border border-line/70 bg-panel/50 px-3 py-2 opacity-70"
          >
            <div className="flex items-center gap-2 text-[11px] tracking-wide text-slate-500 uppercase">
              <span className="text-good">✓</span>
              {TYPE_LABEL[step.type]}
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] text-slate-400">
              {(step.type === "challenge" ? step.prompt : step.text)?.replace(/\s+/g, " ").trim()}
            </p>
            {reveals[index] ? (
              <p className="mono mt-1.5 text-[11px] text-good">→ {reveals[index]}</p>
            ) : null}
          </li>
        ))}

        {current ? (
          <li className="rounded-lg border border-accent/50 bg-accent/5 px-4 py-3">
            <div className="text-[11px] font-semibold tracking-wide text-accent uppercase">
              {TYPE_LABEL[current.type]}
            </div>
            <StepBody step={current} />

            {current.type === "challenge" ? (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setHintVisible((visible) => !visible)}
                  className="rounded border border-line px-2.5 py-1 text-[12px] text-slate-400 hover:border-accent/60 hover:text-slate-200"
                >
                  {hintVisible ? "Hide hint" : "Show hint"}
                </button>
                {hintVisible && current.hint ? (
                  <code className="mono truncate text-[12px] text-slate-300">{current.hint}</code>
                ) : (
                  <span className="text-[12px] text-slate-600">
                    Type the command in the terminal below.
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onContinue}
                className="mt-3 rounded bg-accent px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-accent/90"
              >
                Continue
              </button>
            )}
          </li>
        ) : null}
      </ol>

      {finished ? (
        <div className="mt-5 rounded-lg border border-good/40 bg-good/5 p-4">
          <p className="text-sm font-medium text-good">Lesson complete.</p>
          <div className="mt-3 flex gap-2">
            {hasNextLesson ? (
              <button
                type="button"
                onClick={onNextLesson}
                className="rounded bg-good px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-good/90"
              >
                Next lesson →
              </button>
            ) : (
              <span className="text-[13px] text-slate-400">
                You finished the whole story. Keep experimenting in the terminal.
              </span>
            )}
            <button
              type="button"
              onClick={onRestartLesson}
              className="rounded border border-line px-3 py-1.5 text-[13px] text-slate-400 hover:text-slate-200"
            >
              Replay this lesson
            </button>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
