const KEY = "mw.reviewer";
let memory = "";

/** The reviewer's display name, sent as X-Actor and recorded in history. Storage may be unavailable. */
export function getReviewer(): string {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setReviewer(name: string) {
  memory = name;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* private mode: keep it in memory for this session */
  }
}
