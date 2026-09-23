import { act, renderHook } from '@testing-library/react';
import { seedPlan } from '@/data/seed';
import { ApiError, getPlan, savePlan } from '@/utils/api';
import { useCollaboration } from '@/utils/useCollaboration';

jest.mock('@/utils/api', () => ({
  ...jest.requireActual('@/utils/api'), getPlan: jest.fn(), savePlan: jest.fn(),
}));
const save = savePlan as jest.Mock;
const read = getPlan as jest.Mock;
const tick = async (ms = 500) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

test('opening a plan does not save; clean viewers receive remote updates', async () => {
  const apply = jest.fn();
  read.mockResolvedValue({ plan: seedPlan, version: 2 });
  renderHook(() => useCollaboration(seedPlan, 1, true, false, apply));
  await tick(5000);
  expect(save).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledTimes(1);
});

test('edits during an in-flight save are queued using the returned version', async () => {
  let finish!: (value: { version: number }) => void;
  save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  save.mockResolvedValue({ version: 3 });
  const hook = renderHook(({ plan }) => useCollaboration(plan, 1, true, false, jest.fn()), { initialProps: { plan: seedPlan } });
  hook.rerender({ plan: { ...seedPlan, people: [] } });
  await tick();
  hook.rerender({ plan: { ...seedPlan, people: [], workItems: [] } });
  await tick();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ version: 2 }); });
  await tick();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][1]).toBe(2);
});

test('conflicts retain local edits and block further writes and navigation', async () => {
  save.mockRejectedValue(new ApiError('conflict', 409));
  const apply = jest.fn();
  const hook = renderHook(({ plan }) => useCollaboration(plan, 1, true, false, apply), { initialProps: { plan: seedPlan } });
  hook.rerender({ plan: { ...seedPlan, people: [] } });
  await tick();
  await tick(10000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  expect(hook.result.current.canLeave()).toBe(false);
  expect(hook.result.current.status).toContain('协作冲突');
});

test('open editors pause remote replacement', async () => {
  const apply = jest.fn();
  renderHook(() => useCollaboration(seedPlan, 1, true, true, apply));
  await tick(10000);
  expect(read).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

test('network failure retains edits and retries', async () => {
  save.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ version: 2 });
  const hook = renderHook(({ plan }) => useCollaboration(plan, 1, true, false, jest.fn()), { initialProps: { plan: seedPlan } });
  hook.rerender({ plan: { ...seedPlan, people: [] } });
  await tick();
  expect(hook.result.current.canLeave()).toBe(false);
  await tick();
  expect(save).toHaveBeenCalledTimes(2);
  expect(hook.result.current.canLeave()).toBe(true);
});
