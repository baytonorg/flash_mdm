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

  it('does not close from Escape while an action is pending', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ConfirmModal {...defaultProps} onClose={onClose} />);

    rerender(<ConfirmModal {...defaultProps} onClose={onClose} loading />);

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Processing');
  });

  it('does not close from the backdrop while an action is pending', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} onClose={onClose} loading />);

    await user.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('exposes dialog semantics and an inline error', () => {
    render(<ConfirmModal {...defaultProps} error="Delete failed" />);

    expect(screen.getByRole('dialog', { name: 'Delete Device' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Delete failed');
  });

  it('moves focus into the dialog and restores it when closed', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<ConfirmModal {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    rerender(<ConfirmModal {...defaultProps} open={false} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('wraps focus in both directions', async () => {
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} />);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
  });

  it('redirects attempted focus escape back into the dialog', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} />);

    outside.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    outside.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    outside.remove();
  });

  it('uses the latest onClose callback while open', async () => {
    const originalClose = vi.fn();
    const latestClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ConfirmModal {...defaultProps} onClose={originalClose} />);

    rerender(<ConfirmModal {...defaultProps} onClose={latestClose} />);
    await user.keyboard('{Escape}');

    expect(originalClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it('lets only the topmost modal handle Escape and restores focus down the stack', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <ConfirmModal key="first" {...defaultProps} title="First dialog" onClose={closeFirst} />
        <ConfirmModal key="second" {...defaultProps} title="Second dialog" onClose={closeSecond} />
      </>,
    );

    await user.keyboard('{Escape}');
    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).toHaveBeenCalledOnce();

    rerender(<ConfirmModal key="first" {...defaultProps} title="First dialog" onClose={closeFirst} />);
    expect(screen.getByRole('dialog', { name: 'First dialog' })).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(closeFirst).toHaveBeenCalledOnce();
    rerender(<></>);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('does not let a background modal loading transition steal focus', () => {
    const { rerender } = render(
      <>
        <ConfirmModal key="first" {...defaultProps} title="First dialog" />
        <ConfirmModal key="second" {...defaultProps} title="Second dialog" />
      </>,
    );
    const topDialog = screen.getByRole('dialog', { name: 'Second dialog' });
    expect(topDialog).toContainElement(document.activeElement as HTMLElement);

    rerender(
      <>
        <ConfirmModal key="first" {...defaultProps} title="First dialog" loading />
        <ConfirmModal key="second" {...defaultProps} title="Second dialog" />
      </>,
    );

    expect(topDialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'First dialog' })).not.toHaveFocus();
  });

  it('retains the external restore target when a lower modal closes first', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(
      <>
        <ConfirmModal key="first" {...defaultProps} title="First dialog" />
        <ConfirmModal key="second" {...defaultProps} title="Second dialog" />
      </>,
    );

    rerender(<ConfirmModal key="second" {...defaultProps} title="Second dialog" />);
    expect(screen.getByRole('dialog', { name: 'Second dialog' })).toContainElement(document.activeElement as HTMLElement);
    rerender(<></>);

    expect(outside).toHaveFocus();
    outside.remove();
  });
});
