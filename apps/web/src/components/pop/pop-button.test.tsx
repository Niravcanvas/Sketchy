import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { copy } from '../../copy';
import { PopButton } from './pop-button';

const LABEL = copy.home.primaryActions.createARoom;

describe('PopButton', () => {
  it('renders its label', () => {
    render(<PopButton>{LABEL}</PopButton>);
    expect(screen.getByRole('button', { name: LABEL })).toBeTruthy();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<PopButton onClick={onClick}>{LABEL}</PopButton>);

    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blocks clicks while disabled', () => {
    const onClick = vi.fn();
    render(
      <PopButton onClick={onClick} disabled>
        {LABEL}
      </PopButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<PopButton>{LABEL}</PopButton>);
    const button = screen.getByRole('button', { name: LABEL }) as HTMLButtonElement;

    expect(button.type).toBe('button');
  });

  it('wears the Party Pop border + shadow on the default primary variant', () => {
    render(<PopButton>{LABEL}</PopButton>);
    const button = screen.getByRole('button', { name: LABEL });

    // §4 shape system: every button sits on a 3px ink border with a hard shadow;
    // the default primary variant fills civilian blue.
    expect(button.className).toContain('border-3');
    expect(button.className).toContain('border-ink');
    expect(button.className).toContain('shadow-hard');
    expect(button.className).toContain('bg-civilian');
  });

  it('maps the danger variant to the undercover fill', () => {
    render(<PopButton variant="danger">{LABEL}</PopButton>);
    const button = screen.getByRole('button', { name: LABEL });

    expect(button.className).toContain('bg-undercover');
  });
});
