"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getVirtualFile, saveVirtualFile, INITIAL_MANIFESTS } from "@/engine/virtual-fs";

export interface VimEditorProps {
  filename: string;
  initialContent?: string;
  onSave?: (filename: string, content: string) => void;
  onExit?: () => void;
  onClose?: () => void;
  onSaveAndExit?: (filename: string, content: string) => void;
}

type VimMode = "NORMAL" | "INSERT" | "COMMAND";

export default function VimEditor({
  filename,
  initialContent,
  onSave,
  onExit,
  onClose,
  onSaveAndExit,
}: VimEditorProps) {
  // Safe exit helper
  const handleExitSafe = useCallback(() => {
    if (onExit) onExit();
    if (onClose) onClose();
  }, [onExit, onClose]);

  // Load initial content
  const [content, setContent] = useState<string>(() => {
    if (initialContent !== undefined && initialContent !== "") return initialContent;
    const existing = getVirtualFile(filename);
    if (existing) return existing.content;
    if (INITIAL_MANIFESTS[filename]) return INITIAL_MANIFESTS[filename];
    return `# Kubernetes Manifest: ${filename}\napiVersion: v1\nkind: Pod\nmetadata:\n  name: my-pod\n  labels:\n    app: web\nspec:\n  containers:\n    - name: nginx\n      image: nginx:latest\n      ports:\n        - containerPort: 80\n`;
  });

  const [mode, setMode] = useState<VimMode>("NORMAL");
  const [cursorLine, setCursorLine] = useState<number>(0);
  const [cursorCol, setCursorCol] = useState<number>(0);
  const [commandBuffer, setCommandBuffer] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>(
    `"${filename}" ${content.split("\n").length}L, ${content.length}B`
  );
  const [isModified, setIsModified] = useState<boolean>(false);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);
  const [yankBuffer, setYankBuffer] = useState<string | null>(null);
  const [pendingPrefix, setPendingPrefix] = useState<string>("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const lines = content.split("\n");

  // Keep cursor clamped to valid line and column
  const clampCursor = useCallback((r: number, c: number, currentLines: string[], currentMode: VimMode) => {
    const maxRow = Math.max(0, currentLines.length - 1);
    const targetRow = Math.min(Math.max(0, r), maxRow);
    const lineLen = currentLines[targetRow]?.length || 0;
    const maxCol = currentMode === "INSERT" ? lineLen : Math.max(0, lineLen - 1);
    const targetCol = Math.min(Math.max(0, c), maxCol);
    return { row: targetRow, col: targetCol };
  }, []);

  useEffect(() => {
    if (mode === "INSERT") {
      textareaRef.current?.focus();
    } else if (mode === "COMMAND") {
      commandInputRef.current?.focus();
    } else {
      editorContainerRef.current?.focus();
    }
  }, [mode]);

  // Save operation
  const handleSave = useCallback(() => {
    saveVirtualFile(filename, content);
    setIsModified(false);
    setStatusMessage(`"${filename}" ${lines.length}L, ${content.length}B written`);
    if (onSave) {
      onSave(filename, content);
    }
  }, [filename, content, lines.length, onSave]);

  // Save and Exit operation
  const handleSaveAndExit = useCallback(() => {
    saveVirtualFile(filename, content);
    setIsModified(false);
    if (onSaveAndExit) {
      onSaveAndExit(filename, content);
    } else if (onSave) {
      onSave(filename, content);
      handleExitSafe();
    } else {
      handleExitSafe();
    }
  }, [filename, content, onSave, onSaveAndExit, handleExitSafe]);

  // Normal mode keyboard event handler
  const handleNormalKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== "NORMAL") return;
    const { key } = e;

    // Handle 2-key sequences: 'dd', 'yy', 'gg'
    if (pendingPrefix === "d") {
      setPendingPrefix("");
      if (key === "d") {
        e.preventDefault();
        const deletedLine = lines[cursorLine] || "";
        setYankBuffer(deletedLine);
        const newLines = lines.length <= 1 ? [""] : [...lines.slice(0, cursorLine), ...lines.slice(cursorLine + 1)];
        const newContent = newLines.join("\n");
        setContent(newContent);
        setIsModified(true);
        const nextClamped = clampCursor(cursorLine, cursorCol, newLines, "NORMAL");
        setCursorLine(nextClamped.row);
        setCursorCol(nextClamped.col);
        setStatusMessage("1 line deleted");
        return;
      }
    } else if (pendingPrefix === "y") {
      setPendingPrefix("");
      if (key === "y") {
        e.preventDefault();
        setYankBuffer(lines[cursorLine] || "");
        setStatusMessage("1 line yanked");
        return;
      }
    } else if (pendingPrefix === "g") {
      setPendingPrefix("");
      if (key === "g") {
        e.preventDefault();
        setCursorLine(0);
        setCursorCol(0);
        return;
      }
    }

    if (key === "i" || key === "Insert") {
      e.preventDefault();
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
      return;
    }

    if (key === "I") {
      e.preventDefault();
      const currentLine = lines[cursorLine] || "";
      const firstNonSpace = currentLine.search(/\S/);
      setCursorCol(firstNonSpace >= 0 ? firstNonSpace : 0);
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
      return;
    }

    if (key === "a") {
      e.preventDefault();
      setCursorCol((c) => Math.min(lines[cursorLine]?.length || 0, c + 1));
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
      return;
    }

    if (key === "A") {
      e.preventDefault();
      setCursorCol(lines[cursorLine]?.length || 0);
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
      return;
    }

    if (key === ":") {
      e.preventDefault();
      setMode("COMMAND");
      setCommandBuffer("");
      return;
    }

    if (key === "d") {
      e.preventDefault();
      setPendingPrefix("d");
      return;
    }

    if (key === "y") {
      e.preventDefault();
      setPendingPrefix("y");
      return;
    }

    if (key === "g") {
      e.preventDefault();
      setPendingPrefix("g");
      return;
    }

    if (key === "G") {
      e.preventDefault();
      setCursorLine(lines.length - 1);
      setCursorCol(0);
      return;
    }

    if (key === "p") {
      e.preventDefault();
      if (yankBuffer !== null) {
        const newLines = [
          ...lines.slice(0, cursorLine + 1),
          yankBuffer,
          ...lines.slice(cursorLine + 1),
        ];
        setContent(newLines.join("\n"));
        setIsModified(true);
        setCursorLine(cursorLine + 1);
        setCursorCol(0);
        setStatusMessage("1 line pasted below");
      }
      return;
    }

    if (key === "P") {
      e.preventDefault();
      if (yankBuffer !== null) {
        const newLines = [
          ...lines.slice(0, cursorLine),
          yankBuffer,
          ...lines.slice(cursorLine),
        ];
        setContent(newLines.join("\n"));
        setIsModified(true);
        setCursorCol(0);
        setStatusMessage("1 line pasted above");
      }
      return;
    }

    if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      setCursorLine((l) => Math.max(0, l - 1));
    } else if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      setCursorLine((l) => Math.min(lines.length - 1, l + 1));
    } else if (key === "ArrowLeft" || key === "h") {
      e.preventDefault();
      setCursorCol((c) => Math.max(0, c - 1));
    } else if (key === "ArrowRight" || key === "l") {
      e.preventDefault();
      setCursorCol((c) => Math.min(Math.max(0, (lines[cursorLine]?.length || 1) - 1), c + 1));
    } else if (key === "0" || key === "Home" || key === "^") {
      e.preventDefault();
      setCursorCol(0);
    } else if (key === "$" || key === "End") {
      e.preventDefault();
      setCursorCol(Math.max(0, (lines[cursorLine]?.length || 0) - 1));
    } else if (key === "x") {
      e.preventDefault();
      const currentLine = lines[cursorLine] || "";
      if (currentLine.length > 0) {
        const newLine = currentLine.slice(0, cursorCol) + currentLine.slice(cursorCol + 1);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        setContent(newLines.join("\n"));
        setIsModified(true);
        setCursorCol((c) => Math.min(c, Math.max(0, newLine.length - 1)));
        setStatusMessage("1 character deleted");
      }
    } else if (key === "o") {
      e.preventDefault();
      const currentLine = lines[cursorLine] || "";
      const matchIndent = currentLine.match(/^(\s*)/);
      const indent = matchIndent ? matchIndent[1] : "";
      const newLines = [...lines.slice(0, cursorLine + 1), indent, ...lines.slice(cursorLine + 1)];
      setContent(newLines.join("\n"));
      setCursorLine(cursorLine + 1);
      setCursorCol(indent.length);
      setIsModified(true);
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
    } else if (key === "O") {
      e.preventDefault();
      const currentLine = lines[cursorLine] || "";
      const matchIndent = currentLine.match(/^(\s*)/);
      const indent = matchIndent ? matchIndent[1] : "";
      const newLines = [...lines.slice(0, cursorLine), indent, ...lines.slice(cursorLine)];
      setContent(newLines.join("\n"));
      setCursorCol(indent.length);
      setIsModified(true);
      setMode("INSERT");
      setStatusMessage("-- INSERT --");
    }
  };

  // Insert mode change handler
  const handleInsertChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    setIsModified(true);
    const pos = e.target.selectionStart;
    const textBefore = val.slice(0, pos);
    const beforeLines = textBefore.split("\n");
    setCursorLine(beforeLines.length - 1);
    setCursorCol(beforeLines[beforeLines.length - 1].length);
  };

  // Insert mode key down handler
  const handleInsertKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setMode("NORMAL");
      setStatusMessage("");
      const currentLineLen = lines[cursorLine]?.length || 0;
      setCursorCol((c) => Math.min(c, Math.max(0, currentLineLen - 1)));
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Insert 2 spaces for standard Kubernetes YAML
      const pos = e.currentTarget.selectionStart;
      const newContent = content.slice(0, pos) + "  " + content.slice(pos);
      setContent(newContent);
      setIsModified(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = pos + 2;
          textareaRef.current.selectionEnd = pos + 2;
        }
      }, 0);
    }
  };

  // Command mode key down handler
  const handleCommandKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setMode("NORMAL");
      setCommandBuffer("");
      setStatusMessage("");
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeVimCommand(commandBuffer.trim());
    }
  };

  // Command execution dispatcher
  const executeVimCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (trimmed === "w" || trimmed === "write") {
      handleSave();
      setMode("NORMAL");
    } else if (trimmed === "wq" || trimmed === "x" || trimmed === "exit") {
      handleSaveAndExit();
    } else if (trimmed === "q" || trimmed === "quit") {
      if (isModified) {
        setMode("NORMAL");
        setStatusMessage("E37: No write since last change (add ! to override)");
      } else {
        handleExitSafe();
      }
    } else if (trimmed === "q!" || trimmed === "quit!") {
      handleExitSafe();
    } else if (trimmed === "set nu" || trimmed === "set number") {
      setShowLineNumbers(true);
      setMode("NORMAL");
      setStatusMessage("Line numbers enabled");
    } else if (trimmed === "set nonu" || trimmed === "set nonumber") {
      setShowLineNumbers(false);
      setMode("NORMAL");
      setStatusMessage("Line numbers disabled");
    } else if (trimmed === "help") {
      setMode("NORMAL");
      setStatusMessage("Vim commands: :w (save), :wq (save & exit), :q (quit), :q! (discard), :set nu");
    } else if (/^\d+$/.test(trimmed)) {
      const lineNum = Math.min(lines.length, Math.max(1, parseInt(trimmed, 10))) - 1;
      setCursorLine(lineNum);
      setCursorCol(0);
      setMode("NORMAL");
      setStatusMessage(`Line ${lineNum + 1}`);
    } else {
      setMode("NORMAL");
      setStatusMessage(`E492: Not an editor command: ${trimmed}`);
    }
  };

  // Template loader helper
  const handleLoadTemplate = (key: string) => {
    if (INITIAL_MANIFESTS[key]) {
      const template = INITIAL_MANIFESTS[key];
      setContent(template);
      setIsModified(true);
      setCursorLine(0);
      setCursorCol(0);
      setStatusMessage(`Loaded template: ${key}`);
    }
  };

  // YAML line colorizer helper
  const renderYamlLine = (line: string, idx: number) => {
    const isCurrent = idx === cursorLine;
    const trimmed = line.trimStart();

    let formattedSpan = <span className="text-slate-200">{line}</span>;

    if (trimmed.startsWith("#")) {
      formattedSpan = <span className="text-slate-500 italic">{line}</span>;
    } else if (trimmed === "---") {
      formattedSpan = <span className="text-amber-400 font-bold">---</span>;
    } else if (trimmed.startsWith("- ")) {
      formattedSpan = (
        <span>
          <span className="text-slate-400">{line.slice(0, line.indexOf("-"))}</span>
          <span className="text-sky-400 font-bold">- </span>
          <span className="text-emerald-300">{line.slice(line.indexOf("-") + 2)}</span>
        </span>
      );
    } else if (line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const keyPart = line.slice(0, colonIdx);
      const valPart = line.slice(colonIdx + 1);
      const valTrimmed = valPart.trim();
      const isNum = /^\d+$/.test(valTrimmed);
      const isBool = valTrimmed === "true" || valTrimmed === "false";

      formattedSpan = (
        <span>
          <span className="text-sky-300 font-semibold">{keyPart}</span>
          <span className="text-slate-400">:</span>
          <span className={isNum ? "text-purple-300 font-mono" : isBool ? "text-amber-300 font-semibold" : "text-emerald-200"}>
            {valPart}
          </span>
        </span>
      );
    }

    return (
      <div
        key={idx}
        onClick={() => {
          setCursorLine(idx);
          setCursorCol(0);
          editorContainerRef.current?.focus();
        }}
        className={`flex items-center px-2 font-mono text-xs leading-5 hover:bg-[#121e36] cursor-text rounded transition-colors ${
          isCurrent && mode === "NORMAL" ? "bg-[#162544]/70" : ""
        }`}
      >
        {showLineNumbers && (
          <span
            className={`w-8 shrink-0 text-right pr-3 select-none font-mono text-[11px] ${
              isCurrent ? "text-sky-400 font-bold" : "text-slate-600"
            }`}
          >
            {idx + 1}
          </span>
        )}
        <div className="flex-1 whitespace-pre break-all">{formattedSpan}</div>
      </div>
    );
  };

  return (
    <div
      ref={editorContainerRef}
      tabIndex={0}
      onKeyDown={handleNormalKeyDown}
      className="flex flex-col h-full w-full bg-[#070e1b] text-slate-200 font-mono text-xs outline-none select-none relative rounded-lg overflow-hidden border border-sky-500/30 shadow-2xl"
    >
      {/* Top Helper Action Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d1b30] border-b border-[#1f2f4d] select-none shrink-0">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 mr-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/90 shadow-sm" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/90 shadow-sm" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90 shadow-sm" />
          </div>
          <span className="text-sky-400 font-bold">VIM:</span>
          <span className="text-slate-200 font-semibold">{filename}</span>
          {isModified && (
            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/80 px-1.5 py-0.2 rounded border border-amber-800/40">
              [+]
            </span>
          )}
        </div>

        {/* Quick Mode & Command Action Buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => {
              setMode("INSERT");
              setStatusMessage("-- INSERT --");
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              mode === "INSERT"
                ? "bg-emerald-600 text-white border-emerald-400 shadow-sm"
                : "bg-[#14233c] text-slate-300 border-[#263c60] hover:bg-[#1e3458]"
            }`}
            title="Switch to Insert Mode (i)"
          >
            Insert (i)
          </button>
          <button
            onClick={() => {
              setMode("NORMAL");
              setStatusMessage("");
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              mode === "NORMAL"
                ? "bg-sky-600 text-white border-sky-400 shadow-sm"
                : "bg-[#14233c] text-slate-300 border-[#263c60] hover:bg-[#1e3458]"
            }`}
            title="Switch to Normal Mode (Esc)"
          >
            Normal (Esc)
          </button>
          <button
            onClick={handleSaveAndExit}
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-900/70 text-emerald-300 border border-emerald-600/50 hover:bg-emerald-800/80 transition-colors"
            title="Save and Exit (:wq)"
          >
            Save & Exit (:wq)
          </button>
          <button
            onClick={() => handleExitSafe()}
            className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-900/60 text-rose-300 border border-rose-600/50 hover:bg-rose-800/80 transition-colors"
            title="Discard changes and exit (:q!)"
          >
            Discard (:q!)
          </button>
        </div>
      </div>

      {/* Templates & Tools Secondary Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#091322] border-b border-[#162540] text-[10px] text-slate-400 select-none shrink-0">
        <div className="flex items-center space-x-1.5">
          <span className="font-semibold text-slate-500">Templates:</span>
          <button
            onClick={() => handleLoadTemplate("pod.yaml")}
            className="px-1.5 py-0.5 rounded bg-[#132038] hover:bg-sky-900/60 hover:text-sky-300 transition-colors"
          >
            Pod
          </button>
          <button
            onClick={() => handleLoadTemplate("deployment.yaml")}
            className="px-1.5 py-0.5 rounded bg-[#132038] hover:bg-sky-900/60 hover:text-sky-300 transition-colors"
          >
            Deployment
          </button>
          <button
            onClick={() => handleLoadTemplate("service.yaml")}
            className="px-1.5 py-0.5 rounded bg-[#132038] hover:bg-sky-900/60 hover:text-sky-300 transition-colors"
          >
            Service
          </button>
          <button
            onClick={() => handleLoadTemplate("replicaset.yaml")}
            className="px-1.5 py-0.5 rounded bg-[#132038] hover:bg-sky-900/60 hover:text-sky-300 transition-colors"
          >
            ReplicaSet
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(content);
              setStatusMessage("YAML copied to clipboard");
            }}
            className="text-slate-400 hover:text-white transition-colors"
            title="Copy YAML to clipboard"
          >
            📋 Copy
          </button>
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className="text-slate-400 hover:text-white transition-colors"
            title="Toggle Line Numbers (:set nu)"
          >
            {showLineNumbers ? "Hide #s" : "Show #s"}
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-auto relative p-2 thin-scroll bg-[#060c18]">
        {mode === "INSERT" ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInsertChange}
            onKeyDown={handleInsertKeyDown}
            spellCheck={false}
            autoFocus
            className="w-full h-full bg-transparent text-emerald-300 font-mono text-xs leading-5 outline-none resize-none select-text p-1 font-medium"
          />
        ) : (
          <div className="space-y-0.5">
            {lines.map((line, idx) => renderYamlLine(line, idx))}
            {/* Tildes for trailing empty space */}
            {Array.from({ length: Math.max(0, 10 - lines.length) }).map((_, i) => (
              <div key={`tilde-${i}`} className="flex items-center px-2 text-sky-900/50 select-none font-mono">
                {showLineNumbers && <span className="w-8 pr-3 text-right">~</span>}
                {!showLineNumbers && <span>~</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Status / Command Line */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#091426] border-t border-[#182844] text-[11px] shrink-0 select-none">
        {mode === "COMMAND" ? (
          <div className="flex items-center w-full">
            <span className="text-amber-400 font-bold mr-1">:</span>
            <input
              ref={commandInputRef}
              type="text"
              value={commandBuffer}
              onChange={(e) => setCommandBuffer(e.target.value)}
              onKeyDown={handleCommandKeyDown}
              autoFocus
              className="flex-1 bg-transparent text-white outline-none font-mono text-xs"
            />
          </div>
        ) : (
          <>
            <div className="flex items-center space-x-2">
              <span
                className={`font-bold uppercase tracking-wider text-[10px] px-1.5 py-0.2 rounded ${
                  mode === "INSERT"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                }`}
              >
                {mode === "INSERT" ? "-- INSERT --" : "NORMAL"}
              </span>
              <span className="text-slate-300 truncate max-w-[280px]">
                {statusMessage}
              </span>
            </div>
            <div className="text-slate-400 font-mono text-[10px]">
              Ln {cursorLine + 1}, Col {cursorCol + 1}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
