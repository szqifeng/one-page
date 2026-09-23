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

export interface TeamSummary {
  id: string;
  name: string;
  code: string;
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
  kind: 'scheduled' | 'edit' | 'restore' | 'baseline';
  actorName: string | null;
  summary: string | null;
  id: string;
  sourceVersion: number;
  backupDate: string;
  backupSlot: string;
  createdAt: string;
}

export interface PlanResponse {
  plan: PlanState;
  version: number;
  updatedAt: string;
}

let activeTeamId = '';
export function bindApiTeam(teamId: string) { activeTeamId = teamId; }

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
    ...init,
    headers: { 'Content-Type': 'application/json', ...(activeTeamId ? { 'X-Team-Id': activeTeamId } : {}), ...(init?.headers ?? {}) },
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

export function getTeams() {
  return request<{ teams: TeamSummary[]; activeTeamId: string }>('/api/teams');
}

export function createTeam(name: string, code: string) {
  return request<{ team: TeamSummary; user: AuthUser; teams: TeamSummary[] }>('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name, code }),
  });
}

export function switchTeam(teamId: string) {
  return request<{ user: AuthUser }>(`/api/teams/${encodeURIComponent(teamId)}/switch`, { method: 'POST' });
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

export function getPlanVersions(offset = 0) {
  return request<{ versions: PlanVersion[]; currentVersion: number }>(`/api/plan/versions?offset=${offset}`);
}

export function restorePlanVersion(backupId: string, version: number) {
  return request<{ plan: PlanState; version: number; updatedAt: string }>(`/api/plan/versions/${backupId}/restore`, { method: 'POST', body: JSON.stringify({ version }) });
}
