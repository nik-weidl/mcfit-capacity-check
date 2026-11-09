import * as React from 'react';
import { cn } from '@/lib/utils';

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md bg-secondary p-1 text-foreground',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

const TabsTrigger = React.forwardRef(({ className, active, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-state={active ? 'active' : 'inactive'}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded px-3.5 py-1.5 text-xs font-semibold text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-bold hover:text-foreground',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export { TabsList, TabsTrigger };
