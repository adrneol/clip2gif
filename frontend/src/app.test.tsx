import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadZone from './components/UploadZone';
import TrimControls from './components/TrimControls';
import GifSettings from './components/GifSettings';
import ConversionProgress from './components/ConversionProgress';
import ColdStartNotice from './components/ColdStartNotice';
import { formatTime, formatBytes } from './utils/format';
import type { Limits } from './types';

const limits: Limits = {
  maxUploadMB: 100,
  maxUploadBytes: 104857600,
  maxSourceDurationSeconds: 600,
  maxClipDurationSeconds: 120,
  maxGifOutputMB: 50,
  maxGifOutputBytes: 52428800,
  allowedExtensions: ['.mp4'],
  allowedWidths: [320, 480, 640],
  allowedFps: [5, 8, 10, 12, 15],
  allowedQualities: ['small', 'balanced', 'high'],
  tempFileTtlMinutes: 30,
  jobTimeoutSeconds: 900,
  maxActiveConversions: 1,
  maxQueuedJobs: 3,
};

describe('format utils', () => {
  it('formats time as mm:ss', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(0)).toBe('00:00');
  });
  it('formats bytes', () => {
    expect(formatBytes(500)).toContain('B');
    expect(formatBytes(2048)).toContain('KB');
  });
});

describe('UploadZone', () => {
  it('shows file name + size and removes on click', async () => {
    const onSelect = vi.fn();
    const file = new File(['x'.repeat(100)], 'clip.mp4', { type: 'video/mp4' });
    render(<UploadZone onSelect={onSelect} file={file} maxMB={100} />);
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove selected video'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('TrimControls', () => {
  it('shows selected segment and flags over-long ranges', () => {
    const onChange = vi.fn();
    render(<TrimControls start={10} end={70} duration={90} maxClip={120} onChange={onChange} />);
    expect(screen.getByText(/Selected:/)).toBeInTheDocument();
    const { rerender } = { rerender: (_x: unknown) => {} };
    void rerender;
    // over-long
    render(<TrimControls start={0} end={130} duration={200} maxClip={120} onChange={onChange} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('GifSettings', () => {
  it('changes width/fps/quality', async () => {
    const onChange = vi.fn();
    render(<GifSettings width={480} fps={10} quality="balanced" segSeconds={60} limits={limits} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: '320px' }));
    expect(onChange).toHaveBeenCalledWith(320, 10, 'balanced');
    await userEvent.click(screen.getByRole('radio', { name: '15 fps' }));
    expect(onChange).toHaveBeenCalledWith(480, 15, 'balanced');
  });
  it('warns on heavy combos without claiming exact size', () => {
    render(<GifSettings width={640} fps={15} quality="high" segSeconds={120} limits={limits} onChange={() => {}} />);
    expect(screen.getByText(/Final size depends|Heads-up/)).toBeInTheDocument();
  });
});

describe('ConversionProgress', () => {
  it('renders indeterminate state when progress is null', () => {
    render(
      <ConversionProgress
        job={{ id: '1', status: 'converting', progress: null, stage: 'Converting to GIF', params: null, source: null, output: null, error: null, createdAt: 0, updatedAt: 0, expiresAt: null, completedAt: null }}
        uploading={false}
      />
    );
    expect(screen.getByLabelText('Conversion progress')).toBeInTheDocument();
  });
  it('shows error message', () => {
    render(
      <ConversionProgress
        job={{ id: '1', status: 'failed', progress: null, stage: 'Failed', params: null, source: null, output: null, error: { code: 'X', message: 'Boom' }, createdAt: 0, updatedAt: 0, expiresAt: null, completedAt: null }}
        uploading={false}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});

describe('ColdStartNotice', () => {
  it('explains wake-up and offers retry', async () => {
    const onRetry = vi.fn();
    render(<ColdStartNotice elapsed={12} error={null} onRetry={onRetry} />);
    expect(screen.getByText(/waking up/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Retry now'));
    expect(onRetry).toHaveBeenCalled();
  });
});
