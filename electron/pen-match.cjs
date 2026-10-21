// electron/pen-match.cjs
// Pure: which discovered Bluetooth device is the remembered pen? Used by main's
// `select-bluetooth-device` handler to skip the picker, and tested from Vitest.

const UNKNOWN_NAME = 'Unknown Device';

/** A usable remembered pen: a non-empty deviceId or a real name. */
function normalizeTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const deviceId = typeof target.deviceId === 'string' ? target.deviceId : '';
  const rawName = typeof target.deviceName === 'string' ? target.deviceName.trim() : '';
  const deviceName = rawName === UNKNOWN_NAME ? '' : rawName;
  if (!deviceId && !deviceName) return null;
  return { deviceId, deviceName };
}

/**
 * The deviceId to connect to, or null (show the picker).
 * Exact id wins. Otherwise a name match, but only when exactly one device has
 * that name: two identical pens in range must be chosen by hand.
 * @param {{deviceId:string, deviceName?:string}[]} devices
 * @param {{deviceId?:string, deviceName?:string}|null} target
 * @returns {string|null}
 */
function pickRememberedDevice(devices, target) {
  const want = normalizeTarget(target);
  if (!want || !Array.isArray(devices)) return null;

  if (want.deviceId) {
    const byId = devices.find((d) => d && d.deviceId === want.deviceId);
    if (byId) return byId.deviceId;
  }
  if (want.deviceName) {
    const byName = devices.filter((d) => d && d.deviceName === want.deviceName);
    if (byName.length === 1) return byName[0].deviceId;
  }
  return null;
}

module.exports = { pickRememberedDevice, normalizeTarget, UNKNOWN_NAME };
