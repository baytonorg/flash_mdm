import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmModal from '../ConfirmModal';

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  title: 'Delete Device',
  message: 'Are you sure you want to delete this device?',
};

describe('ConfirmModal', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConfirmModal {...defaultProps} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when open=true', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Delete Device')).toBeInTheDocument();
  });

  it('shows title and message', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Delete Device')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this device?')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onClose when cancel button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows custom confirm label', () => {
    render(<ConfirmModal {...defaultProps} confirmLabel="Delete" />);
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('danger variant shows red confirm button', () => {
    render(<ConfirmModal {...defaultProps} variant="danger" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn).toHaveClass('bg-danger');
  });

  it('default variant shows accent confirm button', () => {
    render(<ConfirmModal {...defaultProps} variant="default" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn).toHaveClass('bg-accent');
  });

  it('loading state disables both buttons', () => {
    render(<ConfirmModal {...defaultProps} loading={true} />);
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByText('Processing...')).toBeDisabled();
  });

  it('loading state shows "Processing..." on confirm button', () => {
    render(<ConfirmModal {...defaultProps} loading={true} />);
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
