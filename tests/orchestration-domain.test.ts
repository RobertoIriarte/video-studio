import { describe, expect, it } from 'vitest';
import { assertDag, assertJobTransition, checkpointRequired, planReadyJobs } from '@video-studio/domain';

describe('F3-01 · DAG, estados y scheduler puro', () => {
  it('T06 rechaza ciclos, faltantes y duplicados; admite rombo sin mutar', () => {
    const dag = Object.freeze([{ id: 'a', dependencies: [] }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['a'] }, { id: 'd', dependencies: ['b', 'c'] }]);
    expect(() => assertDag(dag)).not.toThrow();
    expect(() => assertDag([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }])).toThrow('DAG_CYCLE');
    expect(() => assertDag([{ id: 'a', dependencies: ['a'] }])).toThrow('DAG_CYCLE');
    expect(() => assertDag([{ id: 'a', dependencies: ['missing'] }])).toThrow('DAG_MISSING_DEPENDENCY');
    expect(() => assertDag([{ id: 'a', dependencies: [] }, { id: 'a', dependencies: [] }])).toThrow('DAG_DUPLICATE');
    expect(() => assertDag([{ id: 'a', dependencies: ['b', 'b'] }], ['b'])).toThrow('DAG_DUPLICATE_DEPENDENCY');
  });
  it('readiness exige dependencias, fecha, inputs y checkpoint vigentes; pausa bloquea', () => {
    const root = { id: 'root', status: 'SUCCEEDED', dependencies: [], nextRunAtMs: null, inputsCurrent: true, checkpointPending: false };
    const child = { ...root, id: 'child', status: 'PENDING', dependencies: ['root'] };
    expect(planReadyJobs([root, child], 1000, false)).toEqual(['child']);
    for (const change of [{ inputsCurrent: false }, { checkpointPending: true }, { nextRunAtMs: 1001 }, { status: 'STALE' }]) expect(planReadyJobs([root, { ...child, ...change }], 1000, false)).toEqual([]);
    expect(planReadyJobs([{ ...root, status: 'RUNNING' }, child], 1000, false)).toEqual([]);
    expect(planReadyJobs([root, child], 1000, true)).toEqual([]);
    expect(() => planReadyJobs([root], NaN, false)).toThrow('CLOCK_INVALID');
  });
  it.each([['PENDING', 'READY'], ['READY', 'RUNNING'], ['RUNNING', 'SUCCEEDED'], ['RUNNING', 'RETRY_SCHEDULED'], ['WAITING_APPROVAL', 'SUCCEEDED'], ['FAILED', 'PENDING']])('admite transición %s → %s', (from, to) => expect(() => assertJobTransition(from, to)).not.toThrow());
  it.each([['PENDING', 'SUCCEEDED'], ['SUCCEEDED', 'RUNNING'], ['STALE', 'READY'], ['CANCELLED', 'READY'], ['unknown', 'READY']])('rechaza transición %s → %s', (from, to) => expect(() => assertJobTransition(from, to)).toThrow('JOB_TRANSITION_INVALID'));
  it('AUTO omite ordinarios; blockers detienen ambos modos', () => {
    expect(checkpointRequired('AUTO', 'SCRIPT', ['SCRIPT'], false)).toBe(false);
    expect(checkpointRequired('SUPERVISED', 'SCRIPT', ['SCRIPT'], false)).toBe(true);
    expect(checkpointRequired('SUPERVISED', 'DIRECTION', ['SCRIPT'], false)).toBe(false);
    for (const mode of ['AUTO', 'SUPERVISED']) expect(checkpointRequired(mode, 'SCRIPT', [], true)).toBe(true);
  });
});
