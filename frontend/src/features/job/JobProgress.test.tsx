import { fireEvent, render, screen } from '@testing-library/react';
import { JobProgress } from './JobProgress';
import type { JobState } from '../../lib/jobState';

function stateWith(patch: Partial<JobState>): JobState {
  return { status: 'queued', transport: 'sse', progress: null, result: null, error: null, ...patch };
}

describe('TC-14 · JobProgress (four job states)', () => {
  it('renders the progress state with percent + phase (running)', () => {
    render(<JobProgress state={stateWith({ status: 'running', progress: { phase: '擴充中', percent: 42 } })} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('擴充中')).toBeInTheDocument();
    expect(screen.getByText('分析進行中')).toBeInTheDocument();
  });

  it('renders the queued and confirming states as progress (percent falls back to 0)', () => {
    const { rerender } = render(<JobProgress state={stateWith({ status: 'queued' })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    rerender(<JobProgress state={stateWith({ status: 'confirming', result: { count: 3 } })} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders a cancel button only when onCancel is provided, and invokes it', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <JobProgress state={stateWith({ status: 'running' })} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<JobProgress state={stateWith({ status: 'running' })} />);
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });

  it('renders the completed state with the result count', () => {
    render(<JobProgress state={stateWith({ status: 'completed', transport: 'none', result: { count: 128 } })} />);
    expect(screen.getByText('分析完成')).toBeInTheDocument();
    expect(screen.getByText(/128/)).toBeInTheDocument();
  });

  it('renders the partial state distinctly (not mistaken for completed)', () => {
    render(<JobProgress state={stateWith({ status: 'partial', transport: 'none', result: { count: 40 } })} />);
    expect(screen.getByText('部分完成')).toBeInTheDocument();
    expect(screen.queryByText('分析完成')).not.toBeInTheDocument();
  });

  it('renders completed / partial even when result is null (count omitted)', () => {
    const { rerender } = render(
      <JobProgress state={stateWith({ status: 'completed', transport: 'none', result: null })} />,
    );
    expect(screen.getByText('分析完成')).toBeInTheDocument();
    rerender(<JobProgress state={stateWith({ status: 'partial', transport: 'none', result: null })} />);
    expect(screen.getByText('部分完成')).toBeInTheDocument();
  });

  it('renders the failed state with the error message, and a fallback when error is null', () => {
    const { rerender } = render(
      <JobProgress state={stateWith({ status: 'failed', transport: 'none', error: '配額不足' })} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('配額不足');

    rerender(<JobProgress state={stateWith({ status: 'failed', transport: 'none', error: null })} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the canceled state', () => {
    render(<JobProgress state={stateWith({ status: 'canceled', transport: 'none' })} />);
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });
});
