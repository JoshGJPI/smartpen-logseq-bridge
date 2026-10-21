/**
 * Tests for electron/pen-match.cjs: choosing the remembered pen from the
 * devices a Bluetooth scan has found, so the picker can be skipped.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pickRememberedDevice, normalizeTarget } = require('../../../electron/pen-match.cjs');

const dev = (deviceId, deviceName) => ({ deviceId, deviceName });

describe('pickRememberedDevice', () => {
  it('returns null with no target or no devices', () => {
    expect(pickRememberedDevice([dev('a', 'Pen')], null)).toBeNull();
    expect(pickRememberedDevice([dev('a', 'Pen')], {})).toBeNull();
    expect(pickRememberedDevice([], { deviceId: 'a', deviceName: 'Pen' })).toBeNull();
    expect(pickRememberedDevice(undefined, { deviceId: 'a' })).toBeNull();
  });

  it('matches by device id', () => {
    const devices = [dev('x', 'Other'), dev('a', 'Pen')];
    expect(pickRememberedDevice(devices, { deviceId: 'a', deviceName: 'Pen' })).toBe('a');
  });

  it('prefers the id over a name that matches a different device', () => {
    const devices = [dev('x', 'Pen'), dev('a', 'Renamed')];
    expect(pickRememberedDevice(devices, { deviceId: 'a', deviceName: 'Pen' })).toBe('a');
  });

  it('falls back to a unique name when the id has changed', () => {
    const devices = [dev('new-id', 'NWP-F121'), dev('z', 'Headphones')];
    expect(pickRememberedDevice(devices, { deviceId: 'old-id', deviceName: 'NWP-F121' })).toBe('new-id');
  });

  it('does not guess between two devices with the same name', () => {
    const devices = [dev('1', 'NWP-F121'), dev('2', 'NWP-F121')];
    expect(pickRememberedDevice(devices, { deviceId: 'old', deviceName: 'NWP-F121' })).toBeNull();
  });

  it('never matches on the placeholder name', () => {
    const devices = [dev('1', 'Unknown Device')];
    expect(pickRememberedDevice(devices, { deviceId: 'old', deviceName: 'Unknown Device' })).toBeNull();
  });

  it('returns null when the remembered pen is not in range', () => {
    expect(pickRememberedDevice([dev('x', 'Other')], { deviceId: 'a', deviceName: 'Pen' })).toBeNull();
  });
});

describe('normalizeTarget', () => {
  it('rejects non-objects and empty targets', () => {
    expect(normalizeTarget(null)).toBeNull();
    expect(normalizeTarget('pen')).toBeNull();
    expect(normalizeTarget({ deviceId: '', deviceName: '  ' })).toBeNull();
  });

  it('keeps an id-only or name-only target', () => {
    expect(normalizeTarget({ deviceId: 'a' })).toEqual({ deviceId: 'a', deviceName: '' });
    expect(normalizeTarget({ deviceName: ' Pen ' })).toEqual({ deviceId: '', deviceName: 'Pen' });
  });
});
