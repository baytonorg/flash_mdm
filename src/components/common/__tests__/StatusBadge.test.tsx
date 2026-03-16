import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="ACTIVE" />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('formats status text to lowercase', () => {
    render(<StatusBadge status="DISABLED" />);
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('replaces underscores with spaces', () => {
    render(<StatusBadge status="NON_COMPLIANT" />);
    expect(screen.getByText('non compliant')).toBeInTheDocument();
  });

  it('maps ACTIVE to success variant', () => {
    const { container } = render(<StatusBadge status="ACTIVE" />);
    expect(container.firstChild).toHaveClass('text-success');
  });

  it('maps DISABLED to warning variant', () => {
    const { container } = render(<StatusBadge status="DISABLED" />);
    expect(container.firstChild).toHaveClass('text-warning');
  });

  it('maps DELETED to danger variant', () => {
    const { container } = render(<StatusBadge status="DELETED" />);
    expect(container.firstChild).toHaveClass('text-danger');
  });

  it('maps PENDING to warning variant', () => {
    const { container } = render(<StatusBadge status="PENDING" />);
    expect(container.firstChild).toHaveClass('text-warning');
  });

  it('maps ERROR to danger variant', () => {
    const { container } = render(<StatusBadge status="ERROR" />);
    expect(container.firstChild).toHaveClass('text-danger');
  });

  it('uses default variant for unknown status', () => {
    const { container } = render(<StatusBadge status="UNKNOWN_STATUS" />);
    expect(container.firstChild).toHaveClass('text-gray-600');
  });

  it('respects explicit variant override', () => {
    const { container } = render(<StatusBadge status="ACTIVE" variant="danger" />);
    // Even though ACTIVE normally maps to success, the explicit danger override should apply
    expect(container.firstChild).toHaveClass('text-danger');
  });

  it('renders as a span element', () => {
    const { container } = render(<StatusBadge status="ACTIVE" />);
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });

  it('has capitalize class for proper display', () => {
    const { container } = render(<StatusBadge status="active" />);
    expect(container.firstChild).toHaveClass('capitalize');
  });
});
