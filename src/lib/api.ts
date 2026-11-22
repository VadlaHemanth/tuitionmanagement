import type { WorkspaceSnapshot } from '../types';

let authTokenMemory: string | null = null;

export function setAuthToken(token: string | null) {
  authTokenMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenMemory;
}

interface OfflineQueuedMutation {
  id: string;
  url: string;
  method: 'POST' | 'PUT';
  body: unknown;
  createdAt: string;
  label: string;
}

const OFFLINE_QUEUE_KEY = 'tuitio_offline_queue_v1';
const SNAPSHOT_CACHE_KEY = 'tuitio_snapshot_cache_v1';

export function getOfflineQueue(): OfflineQueuedMutation[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueuedMutation[]) : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(items: OfflineQueuedMutation[]) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export function cacheWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  try {
    // Store minimal safe operational cache for offline attendance/homework continuity
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore
  }
}

export function loadCachedWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as WorkspaceSnapshot) : null;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    queueableOffline?: boolean;
    offlineLabel?: string;
  } = {},
): Promise<T> {
  const { method = 'GET', body, queueableOffline = false, offlineLabel = 'Pending update' } = options;

  const headers: Record<string, string> = {
    'X-Requested-With': 'Tuitio-Client',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (authTokenMemory) {
    headers['Authorization'] = `Bearer ${authTokenMemory}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: string }).error || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data as T;
  } catch (err) {
    const isNetworkError = !navigator.onLine || err instanceof TypeError;
    if (isNetworkError && queueableOffline && (method === 'POST' || method === 'PUT')) {
      const queue = getOfflineQueue();
      queue.push({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        method,
        body,
        createdAt: new Date().toISOString(),
        label: offlineLabel,
      });
      saveOfflineQueue(queue);
      throw new Error('Saved offline — will sync automatically once connected.');
    }
    throw err;
  }
}

export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0 || !navigator.onLine) {
    return { synced: 0, remaining: queue.length };
  }

  let synced = 0;
  const remaining: OfflineQueuedMutation[] = [];

  for (const item of queue) {
    try {
      await apiRequest(item.url, { method: item.method, body: item.body });
      synced += 1;
    } catch {
      remaining.push(item);
    }
  }
  saveOfflineQueue(remaining);
  return { synced, remaining: remaining.length };
}

// Formula-injection safe CSV export
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escapeCell = (val: string | number | null | undefined): string => {
    const raw = val == null ? '' : String(val);
    const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${neutralized.replace(/"/g, '""')}"`;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildWhatsAppShareUrl(phone: string, message: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  const indianDigits = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${indianDigits}?text=${encodeURIComponent(message)}`;
}
