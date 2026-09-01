"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type TerminalLineKind = "command" | "output" | "error" | "system" | "success";

export interface TerminalLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
}

const LINE_STYLE: Record<TerminalLineKind, string> = {
  command: "text-slate-100",
  output: "text-slate-400",
  error: "text-bad",
  system: "text-slate-500 italic",
  success: "text-good",
};

interface TerminalProps {
  lines: TerminalLine[];
  onSubmit: (command: string) => void;
  suggestion?: string;
}

export default function Terminal({ lines, onSubmit, suggestion }: TerminalProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  function submit() {
    const command = value.trim();
    if (!command) return;
    setHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);
    setValue("");
    onSubmit(command);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      const next = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setValue(history[next]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (historyIndex === -1) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setValue("");
      } else {
        setHistoryIndex(next);
        setValue(history[next]);
      }
      return;
    }
    if (event.key === "Tab" && suggestion) {
      event.preventDefault();
      setValue(suggestion);
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-line bg-black"
      onClick={() => inputRef.current?.focus()}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-bad/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-good/70" />
        <span className="mono ml-2 text-xs text-slate-500">
          learner@lab:~ — simulated cluster (nothing real is running)
        </span>
        {suggestion ? (
          <span className="mono ml-auto text-[11px] text-slate-600">
            Tab to insert the hint
          </span>
        ) : null}
      </header>

      <div ref={scrollRef} className="thin-scroll mono min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-[1.55]">
        {lines.map((line) => (
          <pre key={line.id} className={`whitespace-pre-wrap ${LINE_STYLE[line.kind]}`}>
            {line.kind === "command" ? `$ ${line.text}` : line.text}
          </pre>
        ))}
      </div>

      <div className="mono flex items-center gap-2 border-t border-line px-4 py-2.5 text-[13px]">
        <span className="text-accent">$</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          placeholder="kubectl ..."
          className="w-full bg-transparent text-slate-100 outline-none placeholder:text-slate-700"
        />
      </div>
    </section>
  );
}
