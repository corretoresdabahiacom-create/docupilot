import { render, screen } from '@testing-library/react';
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@docupilot/shared';
import { describe, expect, it } from 'vitest';
import { Snippet } from './Snippet';

describe('Snippet', () => {
  it('destaca o termo com <mark> e mantém o resto como texto', () => {
    render(<Snippet value={`o ${SNIPPET_OPEN}aluguel${SNIPPET_CLOSE} é mensal`} />);
    expect(screen.getByText('aluguel').tagName).toBe('MARK');
  });
  it('nunca interpreta HTML vindo do documento', () => {
    const { container } = render(
      <Snippet value={`<img src=x onerror=alert(1)> ${SNIPPET_OPEN}<b>x</b>${SNIPPET_CLOSE}`} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
