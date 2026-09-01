import Lab from "@/components/Lab";
import { loadLessons } from "@/engine/lesson-loader";

/**
 * Server component. Its only job is to discover and validate lessons from the
 * filesystem, then hand them to the client. The UI below this point knows
 * nothing about any specific lesson.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  const lessons = loadLessons();

  if (lessons.length === 0) {
    return (
      <main className="grid h-screen place-items-center p-8 text-center">
        <div>
          <h1 className="text-xl font-semibold text-slate-200">No lessons found</h1>
          <p className="mt-2 text-sm text-slate-400">
            Add a <code className="text-sky-300">.yaml</code> lesson file to{" "}
            <code className="text-sky-300">/lessons</code> and reload.
          </p>
        </div>
      </main>
    );
  }

  return <Lab lessons={lessons} />;
}
