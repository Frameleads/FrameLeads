import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DashboardLayout from '../dashboard/layout';
import HowItWorksPage from '../dashboard/how-it-works/page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'FrameLeads Preview UI Review',
  robots: { index: false, follow: false },
};

/** A static, read-only visual review shell. Vercel protects access at deployment level. */
export default function PreviewUiReviewPage() {
  if (process.env.VERCEL_ENV !== 'preview') notFound();

  return (
    <DashboardLayout previewReviewOnly>
      <HowItWorksPage />
    </DashboardLayout>
  );
}
