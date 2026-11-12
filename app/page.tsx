export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "48px auto", padding: "0 16px", color: "#0f172a" }}>
      <h1 style={{ marginBottom: 4 }}>Prove It</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>
        An AI viva for every assignment: students answer spoken questions about their own work.
      </p>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <a href="/submit">Student: submit your assignment</a>
        </li>
        <li>
          <a href="/viva-test">Try a sample viva</a>
        </li>
        <li>
          <a href="/lecturer">Lecturer: see reports</a>
        </li>
      </ul>
    </main>
  );
}
