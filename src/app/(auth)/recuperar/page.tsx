import { Suspense } from 'react';

import { RecoverPasswordForm } from './recover-password-form';

export default function RecoverPasswordPage() {
  return (
    <Suspense fallback={<section className="flex flex-col gap-6" aria-busy="true" />}>
      <RecoverPasswordForm />
    </Suspense>
  );
}
