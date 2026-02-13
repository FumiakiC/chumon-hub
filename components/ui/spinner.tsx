import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SpinnerProps
  extends React.ComponentPropsWithoutRef<typeof Loader2> {
  className?: string
}

export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, ...props }, ref) => {
    return (
      <Loader2
        ref={ref}
        className={cn("h-4 w-4 animate-spin text-muted-foreground", className)}
        {...props}
      />
    )
  }
)
Spinner.displayName = "Spinner"
