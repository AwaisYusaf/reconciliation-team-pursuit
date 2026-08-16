/** Centered card layout for sign-in, sign-up and onboarding (m00). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-start justify-center px-6 py-16">
      {children}
    </div>
  );
}
