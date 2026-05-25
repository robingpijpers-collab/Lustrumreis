import imageCompression from 'browser-image-compression'

// ─── IMAGE COMPRESSION ───────────────────────────────────────────────────────
// Reduces photos to max 1280px and ~200 KB before upload
export async function compressImage(file) {
  return await imageCompression(file, {
    maxSizeMB: 0.2,
    maxWidthOrHeight: 1280,
    useWebWorker: true,
  })
}

// ─── VIDEO COMPRESSION ───────────────────────────────────────────────────────
// Reduces videos to 720p at ~800 kbps using ffmpeg.wasm (single-threaded)
// onProgress(0-100) is called during compression so you can show a progress bar
export async function compressVideo(file, onProgress) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util')

  const ffmpeg = new FFmpeg()

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.min(99, Math.round(progress * 100)))
  })

  // Load single-threaded core from CDN (no SharedArrayBuffer needed)
  await ffmpeg.load({
    coreURL: await toBlobURL(
      'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/umd/ffmpeg-core.js',
      'text/javascript'
    ),
    wasmURL: await toBlobURL(
      'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/umd/ffmpeg-core.wasm',
      'application/wasm'
    ),
  })

  const ext = file.name.split('.').pop() || 'mp4'
  const inputName  = `input.${ext}`
  const outputName = 'output.mp4'

  await ffmpeg.writeFile(inputName, await fetchFile(file))

  await ffmpeg.exec([
    '-i', inputName,
    '-vf', 'scale=-2:720',   // max 720p, keep aspect ratio
    '-vcodec', 'libx264',
    '-crf', '28',            // quality (18=best, 28=good, 35=small)
    '-preset', 'ultrafast',  // fast encode, slightly larger than slow
    '-acodec', 'aac',
    '-b:a', '96k',           // audio bitrate
    '-movflags', '+faststart',
    outputName
  ])

  const data = await ffmpeg.readFile(outputName)
  onProgress?.(100)

  return new File([data.buffer], 'compressed.mp4', { type: 'video/mp4' })
}

// ─── SMART COMPRESS ──────────────────────────────────────────────────────────
// Auto-picks image or video compression based on file type
export async function compressFile(file, onProgress) {
  if (file.type.startsWith('image/')) {
    onProgress?.(30)
    const result = await compressImage(file)
    onProgress?.(100)
    return result
  }
  if (file.type.startsWith('video/')) {
    return await compressVideo(file, onProgress)
  }
  return file // unknown type, return as-is
}
