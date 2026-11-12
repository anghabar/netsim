import { Star } from 'lucide-react';

interface StarRowProps {
  count: number;
  size?: number;
}

export function StarRow({ count, size = 12 }: StarRowProps) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((index) => (
        <Star
          key={index}
          size={size}
          aria-hidden="true"
          className={index < count ? 'fill-current text-yellow-400' : 'text-zinc-700'}
        />
      ))}
    </span>
  );
}
