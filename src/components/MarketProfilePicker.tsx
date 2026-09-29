'use client';

import FrameSelect, { type FrameSelectOption } from '@/components/ui/FrameSelect';

export type MarketProfilePickerOption = { value: string; label: string; description?: string | null };

export default function MarketProfilePicker({ value, options, onChange, className = '' }: {
  value: string;
  options: MarketProfilePickerOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const allOptions: FrameSelectOption[] = [
    { value: 'AUTO', label: 'Auto · Prospect country', description: 'Resolve independently for each lead.' },
    ...options.map(option => ({ ...option, description: option.description || undefined })),
  ];
  return <FrameSelect ariaLabel="Market profile" value={allOptions.some(option => option.value === value) ? value : 'AUTO'} options={allOptions}
    onValueChange={onChange} className={className} />;
}
