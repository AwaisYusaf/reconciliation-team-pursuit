import { initialsFor } from "@/src/domain/user-display";
import { cn } from "@/src/lib/cn";

/**
 * Someone's profile photo, falling back to their initials.
 *
 * Used wherever a person is named next to what they did — the audit trail today, and the
 * users list if it wants one. The header's own avatar is inside `ProfileMenu`, which is a
 * client component with a menu attached; this is the plain presentational half.
 *
 * A plain `<img>`, not `next/image`. These are one-per-row, already small, and served from a
 * route that streams bytes with its own cache headers — the optimiser has nothing to add and
 * would only put a second cache in front of a private, per-organisation object.
 */
export function UserAvatar({
  name,
  email,
  avatarKey,
  size = 28,
  className,
}: {
  name: string | null;
  email: string;
  /** The owner's `users.avatar_key`; null until they upload a photo. */
  avatarKey?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = initialsFor(name, email);

  return (
    <span
      // `aria-hidden`: every place this is used prints the person's name beside it, so a
      // screen reader announcing initials too would say the same person twice.
      aria-hidden="true"
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-full overflow-hidden",
        "bg-section border border-line text-sub font-bold select-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {avatarKey ? (
        // eslint-disable-next-line @next/next/no-img-element -- see the note above.
        <img
          src={`/api/users/avatar?key=${encodeURIComponent(avatarKey)}`}
          alt=""
          width={size}
          height={size}
          className="w-full h-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}
