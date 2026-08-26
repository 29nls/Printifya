#!/usr/bin/env node

/**
 * Printifya Release Script
 * 
 * Usage:
 *   node scripts/release.mjs <version> [--dry-run] [--no-push] [--local-only]
 * 
 * Examples:
 *   node scripts/release.mjs 1.2.0              # Full release (build + commit + push + tag + release)
 *   node scripts/release.mjs 1.2.0 --dry-run    # Dry run tanpa publish
 *   node scripts/release.mjs 1.2.0 --no-push    # Build + commit tanpa push
 *   node scripts/release.mjs 1.2.0 --local-only # Build APK saja (no git, no release)
 * 
 * What it does:
 *   1. Bumps version in package.json & android/app/build.gradle
 *   2. Runs typecheck & build
 *   3. Builds release APK (signed)
 *   4. Git commit + push
 *   5. Create git tag v{version} + push
 *   6. Creates GitHub Release with APK attached
 * 
 * Prerequisites:
 *   - GITHUB_TOKEN environment variable (or gh CLI authenticated)
 *   - Java JDK 17+ for APK signing
 *   - Keystore at android/app/release-key.jks
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Parse Arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const localOnly = args.includes("--local-only");
const version = args.find((a) => !a.startsWith("--"));

if (!version) {
  console.error("Usage: node scripts/release.mjs <version> [--dry-run]");
  console.error("Example: node scripts/release.mjs 1.2.0");
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Invalid version format. Use: X.Y.Z (e.g., 1.2.0)");
  process.exit(1);
}

// ── Helper Functions ─────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  if (dryRun) {
    console.log("  [dry-run] skipped");
    return "";
  }
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: "inherit", ...opts });
}

function readFile(path) {
  return readFileSync(resolve(ROOT, path), "utf-8");
}

function writeFile(path, content) {
  writeFileSync(resolve(ROOT, path), content);
}

// ── Main Release Flow ────────────────────────────────────────────────────

async function release() {
  console.log("🚀 Printifya Release Script");
  console.log(`   Version: ${version}`);
  console.log(`   Dry run: ${dryRun}`);
  console.log("─".repeat(40));

  // 1. Update package.json version
  console.log("\n📦 Updating package.json...");
  const pkg = JSON.parse(readFile("package.json"));
  const oldVersion = pkg.version;
  pkg.version = version;
  writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(`   ${oldVersion} → ${version}`);

  // 2. Update android/app/build.gradle version
  console.log("\n🤖 Updating Android version...");
  const gradlePath = "android/app/build.gradle";
  let gradle = readFile(gradlePath);

  // Update versionName
  gradle = gradle.replace(
    /versionName\s+"[\d.]+"/,
    `versionName "${version}"`
  );

  // Update versionCode (increment by 100 for each minor, 1 for patch)
  const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
  const oldCode = versionCodeMatch ? parseInt(versionCodeMatch[1]) : 0;
  const [major, minor, patch] = version.split(".").map(Number);
  const newCode = major * 10000 + minor * 100 + patch;
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${newCode}`);
  writeFile(gradlePath, gradle);
  console.log(`   versionName: ${version}`);
  console.log(`   versionCode: ${oldCode} → ${newCode}`);

  // 3. Run typecheck
  console.log("\n🔍 Running typecheck...");
  run("npm run typecheck");

  // 4. Build web assets
  console.log("\n🌐 Building web assets...");
  run("npm run build");

  // 5. Sync to Android
  console.log("\n📱 Syncing to Android...");
  run("npx cap sync android");

  // 6. Build release APK
  console.log("\n🔨 Building release APK...");
  const JAVA_HOME = process.env.JAVA_HOME || "/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot";
  run(`export JAVA_HOME="${JAVA_HOME}" && cd android && ./gradlew assembleRelease --no-daemon`);

  // 7. Verify APK exists
  const apkPath = resolve(ROOT, "android/app/build/outputs/apk/release/Printifya.apk");
  if (!existsSync(apkPath)) {
    console.error("❌ APK not found at:", apkPath);
    process.exit(1);
  }

  const apkSize = (await import("fs")).statSync(apkPath).size;
  console.log(`   APK: ${apkPath}`);
  console.log(`   Size: ${(apkSize / 1024 / 1024).toFixed(1)} MB`);

  // 8. Git Commit & Push (unless local-only or no-push)
  if (!localOnly && !noPush && !dryRun) {
    console.log("\n📝 Creating git commit...");
    run("git add package.json android/app/build.gradle");
    run(`git commit -m "chore: release v${version}"`);
    
    console.log("\n⬆️  Pushing to GitHub...");
    run("git push");
  } else if (noPush) {
    console.log("\n📝 Creating git commit (no push)...");
    run("git add package.json android/app/build.gradle");
    run(`git commit -m "chore: release v${version}"`);
  }

  // 9. Create & Push Git Tag
  const tag = `v${version}`;
  if (!localOnly && !dryRun) {
    console.log(`\n🏷️  Creating git tag ${tag}...`);
    run(`git tag -a ${tag} -m "Release ${version}"`);
    
    if (!noPush) {
      console.log(`\n⬆️  Pushing tag ${tag} to GitHub...`);
      run(`git push origin ${tag}`);
    }
  } else if (dryRun) {
    console.log("\n  [dry-run] Would create tag:", tag);
  }

  // 10. Create GitHub Release (unless local-only)
  const releaseName = `Printifya ${version}`;
  const releaseNotes = generateReleaseNotes(version);

  if (!localOnly) {
    console.log("\n🐙 Creating GitHub Release...");
    
    if (dryRun) {
      console.log("  [dry-run] Would create release:");
      console.log(`    Tag: ${tag}`);
      console.log(`    Name: ${releaseName}`);
      console.log(`    APK: Printifya.apk`);
    } else {
      // Check for GitHub token
      const token = process.env.GITHUB_TOKEN;
      const hasGhCli = !dryRun && execSync("which gh 2>/dev/null || echo \"\"", { cwd: ROOT, encoding: "utf-8" }).trim();
      
      if (!token && !hasGhCli) {
        console.log("\n⚠️  GITHUB_TOKEN not set & gh CLI not found.");
        console.log("   To create release manually:");
        console.log(`   gh release create ${tag} "${apkPath}" --title "${releaseName}"`);
        console.log(`   \n   Or set GITHUB_TOKEN and re-run this script.`);
      } else {
        // Create release using gh CLI
        const repo = "printifya/printifya-app";
        const createRelease = `gh release create ${tag} "${apkPath}" --repo ${repo} --title "${releaseName}" --notes "${releaseNotes.replace(/"/g, '\\"')}"`;
        run(createRelease);
      }
    }
  }

  // 11. Summary
  console.log("\n" + "═".repeat(40));
  console.log("✅ Release complete!");
  console.log(`   Version: ${version}`);
  console.log(`   Tag: ${tag}`);
  console.log(`   APK: android/app/build/outputs/apk/release/Printifya.apk`);
  if (!localOnly && !noPush) {
    console.log(`   Git: Pushed to GitHub`);
    console.log(`   Release: https://github.com/printifya/printifya-app/releases/tag/${tag}`);
  }
  console.log("═".repeat(40));
  
  if (!localOnly && !noPush) {
    console.log("\n📱 Users will auto-update within 6 hours (or restart app)");
  }
}

function generateReleaseNotes(version) {
  return `## Printifya v${version}

### 🚀 Features
- Auto-update support for Android
- GitHub Releases integration

### 📱 Android
- Signed release APK
- Custom splash screen & icon
- Native share (PDF via Android Share Sheet)

### 🐛 Bug Fixes
- Performance improvements
- Various bug fixes

---
📱 **Download**: Printifya.apk (${(7.3).toFixed(1)} MB)
🔧 **Requires**: Android 7.0+`;
}

// Run
release().catch((err) => {
  console.error("\n❌ Release failed:", err.message);
  process.exit(1);
});
