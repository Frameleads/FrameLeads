'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type FrameSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: FrameSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
};

type Position = { left: number; top: number; width: number; maxHeight: number };

export default function FrameSelect({
  value, onValueChange, options, placeholder = 'Select an option', disabled = false,
  id, ariaLabel, ariaLabelledBy, className = '',
}: Props) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => setMounted(true), []);
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled);
  const initialIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, options.findIndex(option => !option.disabled));
  const selected = options.find(option => option.value === value);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(rect.width, viewportWidth - 16);
    const left = Math.min(Math.max(8, rect.left), viewportWidth - width - 8);
    const estimatedHeight = Math.min(288, Math.max(48, options.length * 48));
    const below = viewportHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openAbove = below < Math.min(estimatedHeight, 180) && above > below;
    const maxHeight = Math.max(80, Math.min(288, openAbove ? above : below));
    setPosition({ left, top: openAbove ? Math.max(8, rect.top - Math.min(estimatedHeight, maxHeight) - 6) : rect.bottom + 6, width, maxHeight });
  }, [options.length]);

  useEffect(() => {
    if (!open || !mounted) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onViewportChange = () => updatePosition();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onViewportChange);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      observer?.disconnect();
    };
  }, [open, mounted, updatePosition]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const choose = (option: FrameSelectOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    close(true);
  };
  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let index = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) { setActiveIndex(index); return; }
    }
  };
  const moveToEdge = (edge: 'first' | 'last') => {
    const indexes = options.map((option, index) => ({ option, index })).filter(item => !item.option.disabled);
    if (indexes.length) setActiveIndex(edge === 'first' ? indexes[0].index : indexes[indexes.length - 1].index);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setActiveIndex(initialIndex);
        setOpen(true);
        if (event.key === 'Home') moveToEdge('first');
        if (event.key === 'End') moveToEdge('last');
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveActive(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Home') { event.preventDefault(); moveToEdge('first'); }
    else if (event.key === 'End') { event.preventDefault(); moveToEdge('last'); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  };

  return <>
    <button ref={triggerRef} id={controlId} type="button" role="combobox" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && options[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
      aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} disabled={disabled}
      onClick={() => { if (!disabled) { if (!open) setActiveIndex(initialIndex); setOpen(current => !current); } }}
      onKeyDown={onKeyDown} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}
      className={`flex min-h-10 w-full max-w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-[#333] bg-[#1A1A1A] px-3 py-2 text-left text-white transition-colors duration-150 hover:border-[#FF5A1F]/60 hover:bg-[#242424] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      <span className="min-w-0 flex-1"><span className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm ${selected ? 'text-white' : 'text-[#888]'}`}>{selected?.label ?? placeholder}</span>
        {selected?.description && <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#888]">{selected.description}</span>}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-[#888] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
    {mounted && open && position && createPortal(<div ref={listRef} id={listId} role="listbox"
      aria-label={ariaLabel ? `${ariaLabel} options` : undefined} aria-labelledby={ariaLabelledBy}
      className="overflow-y-auto rounded-xl border border-[#333] bg-[#111] p-1.5 shadow-2xl shadow-black/70"
      style={{ position: 'fixed', zIndex: 10000, left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isActive = index === activeIndex;
        return <div key={option.value} id={`${listId}-option-${index}`} ref={node => { optionRefs.current[index] = node; }}
          role="option" aria-selected={isSelected} aria-disabled={option.disabled || undefined}
          onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}
          className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 ${option.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${isSelected ? 'bg-[#FF5A1F]/10 text-white' : isActive ? 'bg-[#242424] text-white' : 'text-[#D0D0D0] hover:bg-[#242424]'}`}>
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{option.label}</span>
            {option.description && <span className="mt-0.5 block min-w-0 break-words text-xs leading-4 text-[#888]">{option.description}</span>}</span>
          {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#FF5A1F]" />}
        </div>;
      })}
    </div>, document.body)}
  </>;
}
