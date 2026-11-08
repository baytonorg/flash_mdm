import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useNoIndexRobots } from '@/lib/robots';

function Consumer() {
  useNoIndexRobots();
  return null;
}

function Consumers({ first, second }: { first: boolean; second: boolean }) {
  return <>{first && <Consumer />}{second && <Consumer />}</>;
}

describe('useNoIndexRobots', () => {
  it('keeps noindex until the final overlapping consumer unmounts', () => {
    const existing = document.createElement('meta');
    existing.name = 'robots';
    existing.content = 'index, follow';
    document.head.appendChild(existing);

    const view = render(<Consumers first second />);
    expect(existing).toHaveAttribute('content', 'noindex, nofollow, noarchive');

    view.rerender(<Consumers first={false} second />);
    expect(existing).toHaveAttribute('content', 'noindex, nofollow, noarchive');

    view.unmount();
    expect(existing).toHaveAttribute('content', 'index, follow');
    existing.remove();
  });

  it('removes a managed tag only after every consumer unmounts', () => {
    const view = render(<Consumers first second />);
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow, noarchive',
    );

    view.rerender(<Consumers first second={false} />);
    expect(document.head.querySelector('meta[name="robots"]')).toBeInTheDocument();

    view.unmount();
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeInTheDocument();
  });
});
