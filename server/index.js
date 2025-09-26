import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import fs from "fs";
import path from "path";
import os from "os";
import youtubedl from "youtube-dl-exec";
import ffmpeg from "ffmpeg-static";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

let gfs;
const songsCol = () => mongoose.connection.db.collection("songs");
const jobsCol = () => mongoose.connection.db.collection("jobStatus");

// --- main startup ---
async function startServer() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI. Put it in server/.env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  gfs = new GridFSBucket(mongoose.connection.db, { bucketName: "audios" });
  console.log("✅ MongoDB GridFS ready");

  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
}

startServer().catch(err => {
  console.error("❌ Failed to connect to Mongo:", err);
  process.exit(1);
});

// --- Convert + store (async background job) ---
app.post("/api/convert-mp3", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  const filename = `yt-${Date.now()}.mp3`;
  const tempPath = path.join(os.tmpdir(), filename);

  // create job doc (starting)
  await jobsCol().insertOne({
    filename,
    url,
    phase: "starting",
    createdAt: new Date(),
  });

  // Respond immediately so the UI can start polling
  res.json({ success: true, status: "processing", file: filename, path: `/api/files/${filename}` });

  // Background task
  (async () => {
    try {
      // Grab metadata (title, duration, etc.)
      let info;
      try {
        info = await youtubedl(url, { dumpSingleJson: true, noPlaylist: true });
      } catch {
        info = null; // Non-fatal; continue
      }

      // Download + transcode to MP3 using aria2c (fast) and ffmpeg
      await youtubedl(url, {
        noPlaylist: true,
        format: "bestaudio/best",
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: "5",              // speed/size tradeoff; "0" = best (slower)
        ffmpegLocation: ffmpeg,
        output: tempPath,
        externalDownloader: "aria2c",
        externalDownloaderArgs: [
          "--min-split-size=1M",
          "--max-connection-per-server=16",
          "--max-concurrent-downloads=16",
          "--split=16",
        ],
      });

      // Phase -> downloaded (temp file ready)
      await jobsCol().updateOne(
        { filename },
        { $set: { phase: "downloaded", updatedAt: new Date() } }
      );

      // Upload to GridFS
      const uploadStream = gfs.openUploadStream(filename, { contentType: "audio/mpeg" });
      fs.createReadStream(tempPath)
        .pipe(uploadStream)
        .on("finish", async () => {
          // Clean temp
          try { fs.unlinkSync(tempPath); } catch {}
          // Save/Upsert song metadata (library)
          await songsCol().updateOne(
            { filename },
            {
              $set: {
                filename,
                url,
                title: info?.title || filename,
                duration: info?.duration || null,
                contentType: "audio/mpeg",
                ready: true,
                phase: "uploaded",
                updatedAt: new Date(),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true }
          );

          // Job done
          await jobsCol().updateOne(
            { filename },
            { $set: { phase: "uploaded", ready: true, updatedAt: new Date() } }
          );

          console.log(`✅ Stored ${filename} in GridFS & indexed in songs`);
        })
        .on("error", async (err) => {
          console.error("GridFS upload error:", err);
          await jobsCol().updateOne(
            { filename },
            { $set: { phase: "failed", error: "upload failed", updatedAt: new Date() } }
          );
        });
    } catch (err) {
      console.error("yt-dlp pipeline error:", err);
      await jobsCol().updateOne(
        { filename },
        { $set: { phase: "failed", error: String(err), updatedAt: new Date() } }
      );
    }
  })();
});

// --- Job status (for polling) ---
app.get("/api/status/:filename", async (req, res) => {
  const doc = await jobsCol().findOne({ filename: req.params.filename });
  res.json(doc ?? { phase: "pending" });
});

// --- Temporary streaming (phase: downloaded) ---
app.get("/api/temp/:filename", (req, res) => {
  const tempPath = path.join(os.tmpdir(), req.params.filename);
  if (fs.existsSync(tempPath)) {
    res.set("Content-Type", "audio/mpeg");
    fs.createReadStream(tempPath).pipe(res);
  } else {
    res.status(404).json({ error: "Temp file not found" });
  }
});

// --- Permanent streaming (from GridFS) ---
app.get("/api/files/:filename", (req, res) => {
  try {
    const stream = gfs.openDownloadStreamByName(req.params.filename);
    res.set("Content-Type", "audio/mpeg");
    stream.on("error", () => res.status(404).json({ error: "File not found" }));
    stream.pipe(res);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

// --- Library: fetch all songs ---
app.get("/api/songs", async (_req, res) => {
  const items = await songsCol().find({}).sort({ createdAt: -1 }).toArray();
  res.json(items);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
