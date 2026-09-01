# Changelog

All notable changes to Printifya will be documented in this file.

## 1.1.4 (2026-09-01)

### 🐛 Bug Fixes

- **ci:** use npm install instead of npm ci to avoid EBADPLATFORM


## 1.1.3 (2026-08-28)

### 🐛 Bug Fixes

- **ci:** rebuild package-lock.json with all esbuild optional deps


## 1.1.2 (2026-08-28)

### 🐛 Bug Fixes

- **ci:** sync package-lock.json for npm ci compatibility


## 1.1.1 (2026-08-28)

### 🐛 Bug Fixes

- **ci:** upgrade Node.js to v22 and sync package-lock.json


## 1.1.0 (2026-08-28)

### 🚀 Features

- **release:** add auto-changelog and improve release workflow

### 📝 Documentation

- expand auto-update section with check interval details
- add release badges and download link to README


## 1.0.0 (2026-08-28)

### 🚀 Features

- **release:** enhance release script with additional options and detailed output
- **auto-update:** integrate GitHub Releases for automatic updates and add release script
- Implement auto-update feature with dialog and sharing capabilities
- **background-removal:** use SyncedPhotoCompare panel
- **video-face-enhance:** playhead highlight on waveform
- **video-face-enhance:** fps + ETA in the progress bar
- **shared:** live byte/chunk progress in recordWithAudio
- **slideshow-to-video:** photos to WebM video with fade & background music
- **shared:** SyncedPhotoCompare zoom/pan for Enhance Photo & Face Enhance
- **video-face-enhance:** synced timecode overlay in A/B compare
- **video-face-enhance:** waveform tooltip with duration, peak dB, channels
- **video-face-enhance:** click waveform to play/pause source audio
- **video-face-enhance:** frame sampling option for long videos
- **video-face-enhance:** synchronized A/B playback with explicit mute
- **video-face-enhance:** show source audio waveform indicator
- **face-enhance:** compare quality vs video pipeline (PSNR/diff metrics)
- add video face enhancement module with tests
- implement worker pipeline for upscale and denoise processing with OffscreenCanvas
- add per-route error boundary to contain module crashes
- add drag reorder, photobox frames, and cut lines to Auto Layout
- add Waifu2x image processing module for upscale and denoise functionality
- add reset preferences functionality across modules
- Implement auto-crop functionality and layout integration
- Enhance photo studio module with multi-person support and labels
- add document studio features for letter creation and editing
- implement auto crop face and background removal AI modules
- add custom size module, face detection, local printing, and lazy loading
- implement photo studio workflow with upload, crop, and A4 print preview

### 🐛 Bug Fixes

- **background-removal:** keep busy state until latest recolor finishes
- **video-face-enhance:** read MediaRecorder blob duration reliably
- **auto-layout:** clamp grid to saved margin on load
- **background-removal:** keep busy state until latest reprocess finishes
- **slideshow-to-video:** recover preview from frame errors
- **video-face-enhance:** abort run when video switches mid-process
- ignore stale async results on rapid input switch
- **slideshow-to-video:** recover recording from frame errors
- update PSNR handling for lossless formats and improve documentation
- validate stale frameId and correct modern-radius shadow

### ⚡ Performance

- **slideshow-to-video:** prerender photos as ImageBitmap before recording
- **shared:** offload PDF assembly to Web Worker
- **auto-layout:** memoize sheet grid cells
- **auto-layout:** offload batch framing to Web Worker
- **background-removal:** encode result off-thread, stop silent freeze
- **enhance-photo:** offload full-res enhance to Web Worker
- **face-enhance:** run full-res enhance+upscale in Web Worker
- **video-face-enhance:** offload per-frame pipeline to Web Worker
- defer format comparison and yield between batch items

### ♻️ Refactors

- **video-face-enhance:** extract controls/upload/result UI components
- **video-face-enhance:** extract run/recorder/progress into hook
- **video-face-enhance:** extract waveform and compare hooks
- **shared:** extract useExclusiveOp busy guard
- **auto-layout:** use shared blobToDataUrl
- **shared:** add blobToDataUrl helper
- **shared:** add downloadUrl helper
- **shared:** consolidate face pipeline, break sibling coupling
- **face-enhance:** compare pipeline delegates to processFramePixels
- **shared:** extract audioShared + background music in slideshow preview
- **shared:** extract createWorkerClient used by three worker clients
- extract recordWithAudio shared recorder helper

### 🧪 Tests

- **ai-assistant:** golden-image pinning for worker pipeline cores
- **auto-layout:** cover frameAll pool/cancel/fallback
- **shared:** cover double-resolve and mid-stream worker errors
- **shared:** cover pasFoto/autoLayout bridge contracts
- **shared:** cover createWorkerClient async plumbing
- **excel-sheet:** cover formula evaluator
- **video-face-enhance:** waveform & recording share one decoded buffer

### 📝 Documentation

- record Auto Layout frame-worker pipeline in FEATURES & registry
- record Web Worker pipelines for Enhance Photo and Background Removal
- sync shared-architecture list with current helpers

### 🧹 Chores

- release v1.0.0
- remove unused autoLayoutBridge singular aliases
- update .gitignore to include .freebuff directory and remove specific database files
- update database files for improved performance and stability
