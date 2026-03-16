export interface DeviceStateLike {
  state: string;
  snapshot?: Record<string, unknown> | null;
}

export function getDeviceDisplayState(device: DeviceStateLike): string {
  const appliedState = device.snapshot?.appliedState;
  if (typeof appliedState === 'string' && appliedState.trim()) {
    return appliedState;
  }
  return device.state;
}
