import { useEffect, useMemo, useState } from "react";

export default function App() {
  const [videoInput, setVideoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState(null);         // { file, path, status }
  const [status, setStatus] = useState(null);   // { phase, ready, ... }
  const [songs, setSongs] = useState([]);

  // Load library on mount
  useEffect(() => {
    refreshLibrary();
  }, []);

  async function refreshLibrary() {
    try {
      const res = await fetch("/api/songs");
      const data = await res.json();
      setSongs(data);
    } catch (e) {
      console.error("Failed to load songs:", e);
    }
  }

  // Poll status when a job exists
  useEffect(() => {
    if (!job?.file) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${job.file}`);
        const data = await res.json();
        setStatus(data);
        // If uploaded, refresh library once
        if (data?.phase === "uploaded") {
          clearInterval(interval);
          refreshLibrary();
        }
      } catch (e) {
        console.error("Status poll error:", e);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [job]);

  // Decide current stream URL based on phase
  const streamUrl = useMemo(() => {
    if (!job?.file) return null;
    if (status?.phase === "uploaded") return `/api/files/${job.file}`;
    if (status?.phase === "downloaded") return `/api/temp/${job.file}`;
    return null;
  }, [job, status]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!videoInput.trim()) return;

    setLoading(true);
    setStatus(null);
    setJob(null);

    try {
      const res = await fetch("/api/convert-mp3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoInput }),
      });
      const data = await res.json(); // { file, path, status }
      setJob(data);
      setVideoInput("");
    } catch (e) {
      console.error("Convert request failed:", e);
      alert("Conversion failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ marginBottom: 12 }}>YouTube → MP3 (GridFS Library)</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input
          type="text"
          value={videoInput}
          onChange={(e) => setVideoInput(e.target.value)}
          placeholder="Paste a YouTube URL"
          style={{ flex: 1, padding: 10, fontSize: 14 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "10px 14px" }}>
          {loading ? "Starting…" : "Convert"}
        </button>
      </form>

      {job && (
        <div style={{ marginBottom: 24, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
          <div><strong>File:</strong> {job.file}</div>
          <div><strong>Status:</strong> {status?.phase ?? job.status}</div>

          {streamUrl ? (
            <>
              <audio controls src={streamUrl} style={{ width: "100%", marginTop: 12 }} />
              {status?.phase === "uploaded" ? (
                <p style={{ marginTop: 8 }}>
                  <a href={`/api/files/${job.file}`} download>Download MP3</a>
                </p>
              ) : (
                <p style={{ marginTop: 8, opacity: 0.8 }}>
                  Preparing permanent copy… playing temporary stream
                </p>
              )}
            </>
          ) : (
            <p style={{ marginTop: 8, opacity: 0.8 }}>⏳ Working…</p>
          )}
        </div>
      )}

      <h2 style={{ marginBottom: 8 }}>Library</h2>
      {songs.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No songs yet — convert something!</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {songs.map((s) => (
            <li key={s.filename} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600 }}>{s.title || s.filename}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>{s.url}</div>
              <audio controls src={`/api/files/${s.filename}`} style={{ width: "100%" }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
