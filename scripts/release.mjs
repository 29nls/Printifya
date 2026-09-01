#!/usr/bin/env node

/**
 * Printifya Release Script
 *
 * Usage:
 *   node scripts/release.mjs <version> [--dry-run] [--no-push] [--local-only]
 *
 * Examples:
 *   node scripts/release.mjs 1.2.0              # Full release
 *   node scripts/release.mjs 1.2.0 --dry-run    # Dry run
 *   node scripts/release.mjs 1.2.0 --no-push    # Build + commit, no push
 *   node scripts/release.mjs 1.2.0 --local-only # Build APK only
 *
 * Changelog is auto-generated via scripts/generate-changelog.sh from conventional commits.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Parse Arguments ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const localOnly = args.includes("--local-only");
const version = args.find((a) => !a.startsWith("--"));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/release.mjs <version> [--dry-run]");
  console.error("Example: node scripts/release.mjs 1.2.0");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  if (dryRun) {
    console.log("  [dry-run] skipped");
    return "";
  }
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: "pipe", shell: true, ...opts });
  } catch (e) {
    console.error(`Command failed: ${cmd}`);
    throw e;
  }
}

/** Run a command, print output, and throw on failure. */
function runVerbose(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  if (dryRun) {
    console.log("  [dry-run] skipped");
    return "";
  }
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: "inherit", shell: true, ...opts });
  } catch (e) {
    console.error(`Command failed: ${cmd}`);
    throw e;
  }
}

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf-8");
}

function write(path, content) {
  writeFileSync(resolve(ROOT, path), content);
}

function cmdExists(name) {
  try {
    execSync(`which ${name}`, { cwd: ROOT, stdio: "ignore", shell: true });
    return true;
  } catch {
    return false;
  }
}

// ── JAVA_HOME ────────────────────────────────────────────────────────
function getJavaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const isWin = process.platform === "win32";
  const candidates = [
    isWin ? "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot" : "/usr/lib/jvm/java-21",
    isWin ? "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.14.7-hotspot" : "/usr/lib/jvm/java-17",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────
async function release() {
  const tag = `v${version}`;
  const today = new Date().toISOString().slice(0, 10);

  console.log("🚀 Printifya Release Script");
  console.log(`   Version: ${version}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log("─".repeat(40));

  // 1. Bump package.json
  console.log("\n📦 Updating package.json...");
  const pkg = JSON.parse(read("package.json"));
  const oldVersion = pkg.version;
  pkg.version = version;
  write("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(`   ${oldVersion} → ${version}`);

  // 2. Bump android/app/build.gradle
  console.log("\n🤖 Updating Android version...");
  let gradle = read("android/app/build.gradle");
  gradle = gradle.replace(/versionName\s+"[\d.]+"/, `versionName "${version}"`);
  const [major, minor, patch] = version.split(".").map(Number);
  const newCode = major * 10000 + minor * 100 + patch;
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${newCode}`);
  write("android/app/build.gradle", gradle);
  console.log(`   versionName: ${version}`);
  console.log(`   versionCode: ${newCode}`);

  // 3. Generate changelog
  console.log("\n📋 Generating changelog...");
  const changelogScript = resolve(ROOT, "scripts", "generate-changelog.sh");
  const notesPath = resolve(ROOT, ".release-notes.md");

  if (!dryRun) {
    // Generate full changelog for CHANGELOG.md (stdout)
    const changelogEntry = run(`bash "${changelogScript}" "${version}"`);
    console.log(`   Generated changelog (${changelogEntry.split("\n").length} lines)`);

    // Generate compact notes for GitHub Release
    run(`bash "${changelogScript}" "${version}" --notes-file "${notesPath}"`);

    // Update CHANGELOG.md
    const changelogPath = resolve(ROOT, "CHANGELOG.md");
    const header = "# Changelog\n\nAll notable changes to Printifya will be documented in this file.\n\n";

    let existing = "";
    if (existsSync(changelogPath)) {
      existing = readFileSync(changelogPath, "utf-8");
    }
    if (!existing || !existing.startsWith("# Changelog")) {
      existing = header + existing;
    }

    // Insert after header
    const lines = existing.split("\n");
    let insertIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        insertIdx = i;
        break;
      }
      if (i === lines.length - 1) insertIdx = i + 1;
    }
    lines.splice(insertIdx, 0, changelogEntry);
    writeFileSync(changelogPath, lines.join("\n"));
    console.log("   Updated CHANGELOG.md");
  } else {
    console.log("  [dry-run] Would generate changelog");
  }

  // 4. Typecheck
  console.log("\n🔍 Running typecheck...");
  if (!dryRun) runVerbose("npx tsc --noEmit");

  // 5. Build web
  console.log("\n🌐 Building web assets...");
  runVerbose("npx vite build");

  // 6. Sync Android
  console.log("\n📱 Syncing to Android...");
  runVerbose("npx cap sync android");

  // 7. Build release APK
  console.log("\n🔨 Building release APK...");
  const javaHome = getJavaHome();
  if (javaHome) {
    console.log(`   JAVA_HOME: ${javaHome}`);
    process.env.JAVA_HOME = javaHome;
  }
  runVerbose(`cd android && .\\gradlew.bat assembleRelease --no-daemon`);

  // 8. Verify APK
  const releaseDir = resolve(ROOT, "android/app/build/outputs/apk/release");
  let apkPath = null;
  if (!dryRun && existsSync(releaseDir)) {
    const files = readdirSync(releaseDir).filter((f) => f.endsWith(".apk"));
    const signed = files.find((f) => f.includes("release") && !f.includes("unsigned"));
    const chosen = signed || files[0];
    if (chosen) apkPath = resolve(releaseDir, chosen);
  }
  if (!dryRun && !apkPath) {
    console.error("❌ No APK found in:", releaseDir);
    process.exit(1);
  }
  if (!dryRun && apkPath) {
    const size = statSync(apkPath).size;
    console.log(`   APK: ${basename(apkPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // 9. Git commit + push
  if (!localOnly && !noPush && !dryRun) {
    console.log("\n📝 Creating git commit...");
    runVerbose("git add package.json android/app/build.gradle CHANGELOG.md");
    runVerbose(`git commit -m "chore: release v${version}"`);
    console.log("\n⬆️  Pushing to GitHub...");
    runVerbose("git push");
  } else if (!localOnly && !dryRun) {
    console.log("\n📝 Creating git commit (no push)...");
    runVerbose("git add package.json android/app/build.gradle CHANGELOG.md");
    runVerbose(`git commit -m "chore: release v${version}"`);
  }

  // 10. Create + push tag
  if (!localOnly && !dryRun) {
    console.log(`\n🏷️  Creating tag ${tag}...`);
    runVerbose(`git tag -a ${tag} -m "Release ${version}"`);
    if (!noPush) {
      console.log(`\n⬆️  Pushing tag ${tag}...`);
      runVerbose(`git push origin ${tag}`);
    }
  } else if (dryRun) {
    console.log("\n  [dry-run] Would create tag:", tag);
  }

  // 11. GitHub Release (CI handles this automatically via GitHub Actions)
  if (!localOnly && !dryRun && !noPush) {
    console.log("\n🌐 GitHub Release will be created automatically by CI...");
    console.log(`   Tag ${tag} pushed → CI triggers release workflow`);
    console.log(`   Release URL: https://github.com/29nls/Printifya/releases/tag/${tag}`);
  }

  // 12. Cleanup
  if (!dryRun) {
    try {
      if (existsSync(notesPath)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(notesPath);
      }
    } catch { /* ignore */ }
  }

  // 13. Summary
  console.log("\n" + "═".repeat(40));
  console.log("✅ Release complete!");
  console.log(`   Version: ${version}`);
  console.log(`   Tag: ${tag}`);
  console.log(`   APK: ${apkPath ? basename(apkPath) : "N/A"}`);
  if (!localOnly && !noPush) {
    console.log(`   Git: Pushed to GitHub`);
    console.log(`   Release: https://github.com/printifya/printifya-app/releases/tag/${tag}`);
  }
  console.log("═".repeat(40));
}

release().catch((err) => {
  console.error("\n❌ Release failed:", err.message);
  process.exit(1);
});
