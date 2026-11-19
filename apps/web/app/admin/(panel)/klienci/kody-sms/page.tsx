import { Suspense } from 'react';
import { OtpCodeList } from '../../../../../components/admin/access/otp-codes';

/** Użytkownicy → Kody SMS (ADR 0076): kody logowania bez kodu, z „Usuń wygasłe kody”. */
export default function OtpCodesPage() {
  return (
    <main className="page-main">
      <Suspense>
        <OtpCodeList />
      </Suspense>
    </main>
  );
}
