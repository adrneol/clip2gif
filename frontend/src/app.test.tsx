import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadZone from './components/UploadZone';
import TrimControls from './components/TrimControls';
import GifSettings from './components/GifSettings';
import ConversionProgress from './components/ConversionProgress';
import ColdStartNotice from './components/ColdStartNotice';
import GifPreview from './components/GifPreview';
import { formatTime, formatBytes } from './utils/format';
import type { DitherName, Limits, PresetName } from './types';

const limits: Limits = {
  maxUploadMB: 100,
  maxUploadBytes: 104857600,
  maxSourceDurationSeconds: 600,
  maxClipDurationSeconds: 120,
  maxGifOutputMB: 50,
  maxGifOutputBytes: 52428800,
  allowedExtensions: ['.mp4'],
  allowedWidths: [240, 320, 360, 480, 640, 800],
  allowedFps: [5, 6, 8, 10, 12, 15, 20],
  allowedColors: [64, 96, 128, 160, 192, 224, 256],
  allowedDithers: ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none'],
  allowedPresets: ['tiny', 'compact', 'balanced', 'high', 'max', 'custom'],
  presets: {
    tiny: { width: 320, fps: 6, colors: 96, dither: 'bayer', blurb: '' },
    compact: { width: 320, fps: 8, colors: 128, dither: 'bayer', blurb: '' },
    balanced: { width: 480, fps: 10, colors: 192, dither: 'sierra2_4a', blurb: '' },
    high: { width: 640, fps: 12, colors: 256, dither: 'sierra2_4a', blurb: '' },
    max: { width: 640, fps: 15, colors: 256, dither: 'sierra2_4a', blurb: '' },
  },
  defaultPreset: 'balanced',
  suggestedTargetsMB: [5, 10, 15, 20],
  tempFileTtlMinutes: 30,
  jobTimeoutSeconds: 900,
  maxActiveConversions: 1,
  maxQueuedJobs: 3,
};

function settingsProps(over: Partial<Parameters<typeof GifSettings>[0]> = {}) {
  return {
    preset: 'balanced' as PresetName,
    width: 480,
    fps: 10,
    colors: 192,
    dither: 'sierra2_4a' as DitherName,
    optimize: false,
    targetMB: 10,
    segSeconds: 60,
    limits,
    onPreset: () => {},
    onCustom: () => {},
    onOptimize: () => {},
    ...over,
  };
}

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
  it('selects a named preset', async () => {
    const onPreset = vi.fn();
    render(<GifSettings {...settingsProps({ onPreset })} />);
    await userEvent.click(screen.getByRole('radio', { name: /tiny/i }));
    expect(onPreset).toHaveBeenCalledWith('tiny');
  });
  it('opens advanced panel and edits custom values', async () => {
    const onCustom = vi.fn();
    render(<GifSettings {...settingsProps({ onCustom })} />);
    await userEvent.click(screen.getByText('Advanced settings'));
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(4);
    await userEvent.selectOptions(screen.getByLabelText('Palette color count'), '128');
    expect(onCustom).toHaveBeenCalled();
  });
  it('toggles size optimization with targets', async () => {
    const onOptimize = vi.fn();
    render(<GifSettings {...settingsProps({ onOptimize })} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onOptimize).toHaveBeenCalled();
  });
  it('warns on heavy combos without claiming exact size', () => {
    render(<GifSettings {...settingsProps({ width: 640, fps: 15, segSeconds: 120 })} />);
    expect(screen.getByText(/Large-output risk|Size risk|modest file/)).toBeInTheDocument();
    // Must not show a fabricated MB prediction
    expect(screen.queryByText(/\d+\.\d+ MB/)).not.toBeInTheDocument();
  });
});

describe('GifPreview', () => {
  it('shows actual output metadata incl. encode settings', () => {
    render(
      <GifPreview
        url={null}
        job={{
          id: '1', status: 'completed', progress: 100, stage: 'Completed',
          params: null,
          source: { duration: 28, width: 360, height: 640, fps: 30, sizeBytes: 5_000_000, ext: '.mp4' },
          output: { sizeBytes: 9_870_000, width: 360, height: 640, duration: 28, fps: 15, colors: 256, dither: 'bayer', preset: 'max', conversionMs: 12_000, attempts: 1, sizeNote: null },
          error: null, createdAt: 0, updatedAt: 0, expiresAt: null, completedAt: 0,
        }}
      />
    );
    expect(screen.getByText(/9\.41 MB/)).toBeInTheDocument();
    expect(screen.getByText(/GIFs can be larger/)).toBeInTheDocument();
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
