import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import RecentEventsWidget from '../RecentEventsWidget';

afterEach(cleanup);
it('retains action and time for a nullable resource while preserving typed labels', () => {
  render(<RecentEventsWidget events={[
    { id: 'nullable', action: 'audit_event', resource_type: null, created_at: new Date().toISOString() },
    { id: 'typed', action: 'device_updated', resource_type: 'enrollment_token', created_at: new Date(Date.now() - 120000).toISOString() },
  ]} />);
  expect(screen.getByText('Audit event')).toBeInTheDocument();
  expect(screen.getByText('Event · just now')).toBeInTheDocument();
  expect(screen.getByText('Enrollment token · 2 min ago')).toBeInTheDocument();
});
it('preserves the existing empty state', () => {
  render(<RecentEventsWidget events={[]} />);
  expect(screen.getByText('No recent events.')).toBeInTheDocument();
});
