"use client";

import { useMemo } from "react";
import type { Lesson } from "@/engine/lesson-types";

/** Chapter-grouped lesson picker. */
export default function LessonMenu({
  lessons,
  currentIndex,
  onSelect,
  onClose,
}: {
  lessons: Lesson[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const chapters = useMemo(() => {
    const grouped: { chapter: string; items: { lesson: Lesson; index: number }[] }[] = [];
    lessons.forEach((lesson, index) => {
      const last = grouped[grouped.length - 1];
      if (last && last.chapter === lesson.chapter) last.items.push({ lesson, index });
      else grouped.push({ chapter: lesson.chapter, items: [{ lesson, index }] });
    });
    return grouped;
  }, [lessons]);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="thin-scroll absolute top-full right-4 z-20 mt-2 max-h-[70vh] w-[26rem] overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl shadow-black/60">
        {chapters.map((group) => (
          <div key={group.chapter} className="mb-3 last:mb-0">
            <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              {group.chapter}
            </h3>
            <ul className="flex flex-col">
              {group.items.map(({ lesson, index }) => (
                <li key={lesson.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(index)}
                    className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-[12px] ${
                      index === currentIndex
                        ? "bg-accent/15 text-accent"
                        : index < currentIndex
                          ? "text-slate-400 hover:bg-panelsoft"
                          : "text-slate-500 hover:bg-panelsoft hover:text-slate-300"
                    }`}
                  >
                    <span className="mono w-6 shrink-0 text-right opacity-60">{index + 1}</span>
                    <span className="truncate">{lesson.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
