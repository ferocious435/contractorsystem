"use client";

import { UnavailableView } from "@/components/layout/UnavailableView";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <UnavailableView title="לא ניתן להציג את המסך כרגע" message="טעינת המסך לא הושלמה. אפשר לנסות לטעון אותו מחדש או לחזור לפרויקטים." onRetry={reset} />;
}
