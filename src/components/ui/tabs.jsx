import * as React from 'react';
import { cn } from '@/lib/utils';

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md text-foreground lg:bg-secondary lg:p-1',
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
      'inline-flex h-11 min-h-[44px] touch-manipulation items-center justify-center whitespace-nowrap rounded-md border border-border bg-secondary px-3 text-sm font-semibold text-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-foreground data-[state=active]:bg-primary data-[state=active]:font-bold data-[state=active]:text-primary-foreground hover:text-foreground lg:h-8 lg:min-h-0 lg:rounded lg:border-0 lg:bg-transparent lg:px-3.5 lg:py-1.5 lg:text-xs data-[state=active]:lg:border-0',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export { TabsList, TabsTrigger };
