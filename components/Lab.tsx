export default function Lab({ lessons }: { lessons: any[] }) {
  return (
    <div>
      <h1>Lab</h1>
      <p>Lessons loaded: {lessons.length}</p>
    </div>
  );
}
