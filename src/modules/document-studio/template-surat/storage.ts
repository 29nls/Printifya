import type { LetterFields } from "./letterHtml";
import {
  loadJSON,
  loadString,
  removeKeys,
  saveJSON,
  saveString,
} from "../../shared/prefsStorage";

export interface ArchiveEntry {
  id: string;
  savedAt: string; // ISO
  data: LetterFields;
}

const DRAFT_KEY = "printifya.letter-draft";
const ARCHIVE_KEY = "printifya.letter-archive";
const PAPER_KEY = "printifya.letter-paper";
const MAX_ARCHIVE = 50;

/** Draf surat terakhir (auto-save). */
export function loadDraft(): LetterFields | null {
  return loadJSON<LetterFields>(DRAFT_KEY);
}

export function saveDraft(data: LetterFields): void {
  saveJSON(DRAFT_KEY, data);
}

export function clearDraft(): void {
  removeKeys(DRAFT_KEY);
}

/** Riwayat surat tersimpan. */
export function loadArchive(): ArchiveEntry[] {
  const list = loadJSON<ArchiveEntry[]>(ARCHIVE_KEY, (value) =>
    Array.isArray(value) ? (value as ArchiveEntry[]) : null
  );
  return Array.isArray(list) ? list : [];
}

export function saveArchive(entries: ArchiveEntry[]): void {
  saveJSON(ARCHIVE_KEY, entries.slice(0, MAX_ARCHIVE));
}

/** Ukuran kertas terakhir yang dipilih pengguna (id; default A4). */
export function loadPaperId(): string | null {
  return loadString(PAPER_KEY, null);
}

export function savePaperId(id: string): void {
  saveString(PAPER_KEY, id);
}

/** Hapus semua kunci localStorage milik modul ini (draf + riwayat + kertas). */
export function clearAllStorage(): void {
  removeKeys(DRAFT_KEY, ARCHIVE_KEY, PAPER_KEY);
}
