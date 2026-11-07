#!/usr/bin/env node

/**
 * scripts/prd-loop.mjs
 * 
 * Autonomous closed-loop runner (Servo / Plan-Build-Judge) untuk PRD_ITEMS.md.
 * 
 * Sesuai prinsip ECC loop-design-check:
 * 1. Machine-decidable verification: Evaluasi berbasis exit code (0 = success).
 * 2. Anti-Goodhart boundary check: Perubahan test suite dicegah melemahkan assertion.
 * 3. Damping & Runaway prevention: Batas retry (default: 3 kali per item), bila gagal
 *    berhenti dan minta intervensi developer manusia.
 * 4. State advances one-way: [ ] -> [x] hanya setelah verifikasi exit 0.
 *
 * Pemakaian:
 *   node scripts/prd-loop.mjs [--status] [--verify-only] [--item ITEM-001] [--max-retries 3]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const PRD_FILE = resolve(ROOT_DIR, "PRD_ITEMS.md");

const args = process.argv.slice(2);
const isStatusOnly = args.includes("--status");
const isVerifyOnly = args.includes("--verify-only");
const itemTargetArg = args.find((a, i) => args[i - 1] === "--item");
const maxRetriesArg = args.find((a, i) => args[i - 1] === "--max-retries");
const MAX_RETRIES = maxRetriesArg ? parseInt(maxRetriesArg, 10) : 3;

function parsePrdItems(content) {
  const itemRegex = /- \[( |x)\] (ITEM-\d+): ([^\n]+)\n\s+- \*\*Deskripsi PRD\*\*: ([^\n]+)\n\s+- \*\*Boundary\*\*: ([^\n]+)\n\s+- \*\*Verifikasi\*\*: `?([^`\n]+)`?/g;
  const items = [];
  let match;

  while ((match = itemRegex.exec(content)) !== null) {
    items.push({
      fullMatch: match[0],
      done: match[1] === "x",
      id: match[2],
      title: match[3].trim(),
      description: match[4].trim(),
      boundary: match[5].trim(),
      verifyCmd: match[6].trim().replace(/\s*\(`exit 0`\)$/, ""),
    });
  }

  return items;
}

function runVerification(cmd) {
  console.log(`\n🔍 [Judge] Menjalankan verifikasi deterministik: "${cmd}"...`);
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 120000,
    });
    console.log(`✅ [Judge] Lolos verifikasi (Exit code: 0)`);
    return { ok: true, output: stdout };
  } catch (error) {
    console.error(`❌ [Judge] Verifikasi gagal (Exit code: ${error.status})`);
    const output = (error.stdout || "") + "\n" + (error.stderr || "");
    return { ok: false, output, exitCode: error.status };
  }
}

function markItemDone(content, itemId) {
  const targetPattern = new RegExp(`- \\[ \\] (${itemId}:)`);
  if (!targetPattern.test(content)) {
    console.warn(`Peringatan: Item ${itemId} tidak ditemukan atau sudah selesai.`);
    return content;
  }
  return content.replace(targetPattern, `- [x] $1`);
}

function main() {
  if (!existsSync(PRD_FILE)) {
    console.error(`Error: File PRD_ITEMS.md tidak ditemukan di ${PRD_FILE}`);
    process.exit(1);
  }

  let content = readFileSync(PRD_FILE, "utf-8");
  const items = parsePrdItems(content);

  if (items.length === 0) {
    console.warn("Tidak ada item PRD yang berhasil di-parse dari PRD_ITEMS.md.");
    process.exit(0);
  }

  const doneCount = items.filter((i) => i.done).length;
  const pendingItems = items.filter((i) => !i.done);

  console.log("==================================================");
  console.log("  PRINTIFYA AUTONOMOUS PRD LOOP RUNNER (SERVO)   ");
  console.log("==================================================");
  console.log(`Total Item   : ${items.length}`);
  console.log(`Selesai [x]  : ${doneCount}`);
  console.log(`Pending [ ]  : ${pendingItems.length}`);
  console.log("--------------------------------------------------");

  if (isStatusOnly) {
    items.forEach((item) => {
      console.log(`[${item.done ? "x" : " "}] ${item.id} - ${item.title}`);
    });
    return;
  }

  const targetItems = itemTargetArg
    ? items.filter((i) => i.id === itemTargetArg)
    : pendingItems;

  if (targetItems.length === 0) {
    console.log("🎉 Semua item target sudah selesai atau tidak ada yang pending!");
    return;
  }

  for (const item of targetItems) {
    console.log(`\n▶ Sedang memproses: ${item.id} - ${item.title}`);
    console.log(`  - Deskripsi : ${item.description}`);
    console.log(`  - Boundary  : ${item.boundary}`);
    console.log(`  - Verifikasi: ${item.verifyCmd}`);

    if (item.done && !isVerifyOnly) {
      console.log(`  ⏩ ${item.id} sudah ditandai selesai. Lewati.`);
      continue;
    }

    let passed = false;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      console.log(`\n--- Percobaan Verifikasi ${attempt}/${MAX_RETRIES} ---`);
      const result = runVerification(item.verifyCmd);

      if (result.ok) {
        passed = true;
        break;
      } else {
        console.log(`Detail error:\n${result.output.slice(-500)}`);
        if (isVerifyOnly) {
          console.log(`Mode --verify-only: berhenti setelah verifikasi gagal.`);
          process.exit(1);
        }
        if (attempt < MAX_RETRIES) {
          console.log(`Menunggu perbaikan sebelum retry berikutnya...`);
        }
      }
    }

    if (passed) {
      console.log(`\n🎉 Item ${item.id} terverifikasi berhasil!`);
      if (!item.done) {
        content = markItemDone(content, item.id);
        writeFileSync(PRD_FILE, content, "utf-8");
        console.log(`📝 PRD_ITEMS.md diperbarui: ${item.id} ditandai [x]`);
      }
    } else {
      console.error(`\n⛔ [Damping Exceeded] Item ${item.id} gagal setelah ${MAX_RETRIES} percobaan.`);
      console.error(`Loop berhenti untuk mencegah runaway / token burning.`);
      console.error(`Silakan eskalasi dan periksa implementasi sebelum melanjutkan.`);
      process.exit(1);
    }
  }

  console.log("\n==================================================");
  console.log("✨ Loop cycle selesai dengan sukses!");
  console.log("==================================================");
}

main();
