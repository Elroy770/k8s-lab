/**
 * Renders lesson prose: blank lines separate paragraphs, indented blocks stay
 * monospaced, and soft line wrapping in the YAML source is ignored.
 */
export default function Prose({ text, className = "" }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isPreformatted = lines.every((line) => /^\s{4,}/.test(line) || line.trim() === "");

        if (isPreformatted) {
          const indent = Math.min(
            ...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)![0].length),
          );
          return (
            <pre
              key={index}
              className="mono overflow-x-auto rounded-md border border-line bg-black/40 p-3 text-[11.5px] leading-relaxed text-slate-400"
            >
              {lines.map((line) => line.slice(indent)).join("\n")}
            </pre>
          );
        }

        const isList = lines.every((line) => line.trimStart().startsWith("- "));
        if (isList) {
          return (
            <ul key={index} className="ml-4 list-disc space-y-1 text-sm text-slate-300">
              {lines.map((line, item) => (
                <li key={item}>{line.trimStart().slice(2)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="text-sm leading-relaxed text-slate-300">
            {lines.join(" ")}
          </p>
        );
      })}
    </div>
  );
}
