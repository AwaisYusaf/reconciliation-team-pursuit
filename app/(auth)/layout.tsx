/**
 * The signed-out shell (m00).
 *
 * Deliberately bare. The two shapes these screens come in are `AuthSplit` (sign in, sign up)
 * and `AuthCentered` (the onboarding steps) in `src/components/ui/auth-shell.tsx`, and each
 * is full-bleed — a padded, centred wrapper here would inset the split's brand panel away
 * from the edge of the window.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper">{children}</div>;
}
