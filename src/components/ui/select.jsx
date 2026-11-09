import * as React from 'react';
import { cn } from '@/lib/utils';

const NativeSelect = React.forwardRef(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'block h-11 min-h-[44px] w-full min-w-0 max-w-full truncate rounded-md border border-input bg-background px-3.5 py-2 text-base font-medium ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:h-9 lg:min-h-0 lg:px-3 lg:py-1 lg:text-sm',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
