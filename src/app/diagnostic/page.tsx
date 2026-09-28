import type { Metadata } from 'next';
import DiagnosticClient from './DiagnosticClient';

export const metadata: Metadata = {
  title: 'Diagnose My Reply Workflow | FrameLeads',
  description: 'A short, private diagnostic of reply operations, decision speed, governance, prioritization, prospect context, and automation risk.',
};

/** Public route: no session lookup, API request, or persistence. */
export default function DiagnosticPage() { return <DiagnosticClient />; }
