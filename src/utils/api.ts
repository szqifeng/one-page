import type { PlanState } from '@/types/planning';
import { syncActiveQuarter } from '@/utils/quarters';

export interface AuthUser {
  id: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  personId: string;
  account: string;
  displayName: string;
  roleIds: string[];
}

export interface BehaviorLog {
  id: number;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  account: string | null;
  displayName: string | null;
}

export interface PlanVersion {
  id: string;
  sourceVersion: number;
  backupDate: string;
  backupSlot: string;
  createdAt: string;
}

interface PlanResponse {
  plan: PlanState;
  version: number;
  updatedAt: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.message || '请求失败', response.status);
  return body as T;
}

export function getCurrentUser() {
  return request<{ user: AuthUser }>('/api/auth/me');
}

export function getAuthConfig() {
  return request<{ passwordEnabled: boolean; oauthEnabled: boolean }>('/api/auth/config');
}

export function login(account: string, password: string) {
  return request<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  });
}

export function logout() {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function getPlan() {
  return request<PlanResponse>('/api/plan');
}

export function savePlan(plan: PlanState, version: number) {
  return request<{ version: number; updatedAt: string }>('/api/plan', {
    method: 'PUT',
    body: JSON.stringify({ plan: syncActiveQuarter(plan), version }),
  });
}

export function getBehaviorLogs(limit = 200) {
  return request<{ logs: BehaviorLog[] }>(`/api/audit/behaviors?limit=${limit}`);
}

export function getPlanVersions() {
  return request<{ versions: PlanVersion[]; currentVersion: number }>('/api/plan/versions');
}

export function restorePlanVersion(backupId: string) {
  return request<{ plan: PlanState; version: number; updatedAt: string }>(`/api/plan/versions/${backupId}/restore`, { method: 'POST' });
}
