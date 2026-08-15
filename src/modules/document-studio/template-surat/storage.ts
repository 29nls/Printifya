import type { LetterFields } from "./letterHtml";

export interface ArchiveEntry {
  id: string;
  savedAt: string; // ISO
  data: LetterFields;
}

const DRAFT_KEY = "printifya.letter-draft";
const ARCHIVE_KEY = "printifya.letter-archive";
const MAX_ARCHIVE = 50;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Draf surat terakhir (auto-save). */
export function loadDraft(): LetterFields | null {
  return read<LetterFields>(DRAFT_KEY);
}

export function saveDraft(data: LetterFields): void {
  write(DRAFT_KEY, data);
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // abaikan
  }
}

/** Riwayat surat tersimpan. */
export function loadArchive(): ArchiveEntry[] {
  const list = read<ArchiveEntry[]>(ARCHIVE_KEY);
  return Array.isArray(list) ? list : [];
}

export function saveArchive(entries: ArchiveEntry[]): void {
  write(ARCHIVE_KEY, entries.slice(0, MAX_ARCHIVE));
}

/** Hapus semua kunci localStorage milik modul ini (draf + riwayat). */
export function clearAllStorage(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(ARCHIVE_KEY);
  } catch {
    // abaikan
  }
}
